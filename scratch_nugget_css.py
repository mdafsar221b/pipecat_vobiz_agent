import httpx
import re

css_url = "https://www.nugget.com/_next/static/chunks/42uihi17nal5_.css"
headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

try:
    resp = httpx.get(css_url, headers=headers, follow_redirects=True, timeout=15)
    css_text = resp.text
    print("CSS Length:", len(css_text))

    # Look for CSS variables
    root_vars = re.findall(r'--[a-zA-Z0-9_-]+:[^;]+', css_text)
    print("CSS Variables count:", len(root_vars))
    for v in root_vars[:30]:
        print("  ", v.strip())

    # Look for primary, background, fonts
    font_faces = re.findall(r'@font-face\s*\{[^}]+\}', css_text)
    print("Font faces count:", len(font_faces))
    for ff in font_faces[:3]:
        print("  Font face:", ff[:120])

    with open("nugget_styles.css", "w", encoding="utf-8") as f:
        f.write(css_text)
    print("Saved nugget_styles.css")
except Exception as e:
    print("Error:", e)
