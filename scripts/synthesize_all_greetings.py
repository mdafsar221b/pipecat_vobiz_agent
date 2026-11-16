import os
import sys
import asyncio
from pathlib import Path
from dotenv import load_dotenv

# Ensure backend modules can be imported
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR / "backend"))
load_dotenv(BASE_DIR / ".env")

import db
from google import genai
from pipecat.audio.utils import SOXRAudioResampler

async def synthesize_all():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("Missing GEMINI_API_KEY")
        return

    client = genai.Client(api_key=api_key)
    resampler = SOXRAudioResampler()
    assets_dir = BASE_DIR / "assets"
    assets_dir.mkdir(exist_ok=True)

    templates = db.get_templates()
    print(f"Found {len(templates)} templates to verify/synthesize audio for...")

    for tpl in templates:
        tpl_id = tpl.get("template_id")
        telugu_text = tpl.get("greeting_telugu", "").strip()
        if not telugu_text:
            continue

        out_path = assets_dir / f"greeting_{tpl_id}_16k.pcm"
        if out_path.exists() and out_path.stat().st_size > 10000:
            print(f"[SKIP] Audio exists for {tpl_id}: {out_path.name} ({out_path.stat().st_size} bytes)")
            continue

        print(f"[SYNTHESIZING] {tpl_id} -> '{telugu_text[:40]}...'")
        try:
            resp = client.models.generate_content(
                model="gemini-2.5-flash-preview-tts",
                contents=telugu_text,
                config={
                    "response_modalities": ["AUDIO"],
                    "speech_config": {"voice_config": {"prebuilt_voice_config": {"voice_name": "Aoede"}}}
                }
            )
            raw_24k = None
            for part in resp.candidates[0].content.parts:
                if part.inline_data:
                    raw_24k = part.inline_data.data
                    break

            if not raw_24k:
                print(f"[ERROR] No audio data returned for {tpl_id}")
                continue

            pcm_16k = await resampler.resample(raw_24k, 24000, 16000)
            out_path.write_bytes(pcm_16k)
            print(f"[DONE] Saved {out_path.name} ({len(pcm_16k)} bytes, {len(pcm_16k)/32000:.2f}s)")

            # Update template in database with audio path
            db.save_template({
                "template_id": tpl_id,
                "greeting_audio_path": f"assets/greeting_{tpl_id}_16k.pcm"
            })
        except Exception as exc:
            print(f"[ERROR] Failed to synthesize audio for {tpl_id}: {exc}")

if __name__ == "__main__":
    asyncio.run(synthesize_all())
