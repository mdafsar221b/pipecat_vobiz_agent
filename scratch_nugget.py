import httpx
import re

url = "https://www.nugget.com/voice-ai/"
headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

try:
    resp = httpx.get(url, headers=headers, follow_redirects=True, timeout=15)
    print("Status:", resp.status_code)
    print("URL:", resp.url)
    text = resp.text
    print("Page Title:", re.findall(r"<title>(.*?)</title>", text, re.IGNORECASE))

    # Look for CSS files
    css_links = re.findall(r'href="([^"]+\.css[^"]*)"', text)
    print("CSS Links:", css_links[:5])

    # Search for Tailwind or style tokens
    colors = re.findall(r'#[0-9a-fA-F]{6}|rgba?\([^)]+\)', text)
    print("Unique colors count:", len(set(colors)))
    print("Sample colors:", list(set(colors))[:15])

    # Check font families
    fonts = re.findall(r'font-family:[^;"]+', text)
    print("Font definitions:", fonts[:5])

    # Check main tags / sections
    print("Main headings:", re.findall(r'<h[1-3][^>]*>(.*?)</h[1-3]>', text)[:8])

    # Save small snippet for inspection
    with open("nugget_sample.html", "w", encoding="utf-8") as f:
        f.write(text[:20000])
except Exception as e:
    print("Error:", e)
