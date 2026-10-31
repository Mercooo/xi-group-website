#!/usr/bin/env python3
"""Import the XI Group Google Sites into structured JSON for the Astro site.

Crawls the main group site and the four unit sites, converts every page into
sections -> rows -> columns -> blocks, rewrites internal links to the new URL
scheme, and downloads every image into public/images as WebP.

Usage:
    pip install beautifulsoup4 pillow
    python3 scripts/import_google_sites.py [--cache .cache/google-sites]

Re-running is safe: pages and images are cached, output is regenerated.
"""
import argparse
import hashlib
import html
import io
import json
import os
import re
import subprocess
import sys
import urllib.parse
from collections import deque
from concurrent.futures import ThreadPoolExecutor

from bs4 import BeautifulSoup, NavigableString, Tag
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGIN = "https://sites.google.com"

# Google Sites id -> (base path on the new site, short key)
SITES = {
    "xi-group": ("", "group"),
    "xi-buds": ("/buds", "buds"),
    "xi-cubs": ("/cubs", "cubs"),
    "xiscouts": ("/scouts", "scouts"),
    "xi-rovers": ("/rovers", "rovers"),
}

# Google Sites column width classes -> span out of 12
WIDTHS = {
    "uQSCkd": 12, "EehZO": 10, "Clt0zb": 9, "OiUrBf": 8, "OwsYgb": 7,
    "qWD73c": 6, "wNfPc": 5, "II5mzb": 4, "c5RTEf": 3, "ibL1re": 2,
}

SECTION_STYLES = {"qeLZfd": "subtle", "WxWicb": "plain", "lQAHbd": "accent"}

images = {}  # remote url (no size suffix) -> local path


# ---------------------------------------------------------------- crawling

def fetch(path, cache):
    fn = os.path.join(cache, hashlib.md5(path.encode()).hexdigest()[:12] + ".html")
    if not os.path.exists(fn):
        url = ORIGIN + urllib.parse.quote(path)
        subprocess.run(["curl", "-sSfL", "--retry", "3", "-o", fn, url], check=True)
    with open(fn, encoding="utf-8", errors="ignore") as f:
        return f.read()


def norm_path(p):
    return urllib.parse.unquote(html.unescape(p)).split("#")[0].split("?")[0].rstrip("/")


def crawl(cache):
    os.makedirs(cache, exist_ok=True)
    seen, order = {}, []
    q = deque(f"/view/{s}/home" for s in SITES)
    while q:
        p = norm_path(q.popleft())
        if p in seen:
            continue
        raw = fetch(p, cache)
        seen[p] = raw
        order.append(p)
        print(f"  {len(order):3d} {p}", file=sys.stderr)
        for h in re.findall(r'href="(/view/[^"]+)"', raw):
            h = norm_path(h)
            if h.split("/")[2] in SITES and h not in seen:
                q.append(h)
    return order, seen


# ---------------------------------------------------------------- links

def unwrap_google_redirect(href):
    if href.startswith("https://www.google.com/url"):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
        if "q" in qs:
            return qs["q"][0]
    return href


def site_path(view_path):
    """'/view/xi-cubs/a/b' -> '/cubs/a/b'; None if not one of our sites."""
    parts = view_path.strip("/").split("/")
    if len(parts) < 2 or parts[0] != "view" or parts[1] not in SITES:
        return None
    base = SITES[parts[1]][0]
    rest = [p for p in parts[2:] if p]
    if rest[:1] == ["home"] and len(rest) == 1:
        rest = []
    elif rest[:1] == ["home"]:
        rest = rest  # sub pages of home keep the 'home' segment for uniqueness
    return (base + "/" + "/".join(rest)).rstrip("/") or "/"


def rewrite_href(href):
    if not href:
        return href
    href = unwrap_google_redirect(html.unescape(href))
    frag = ""
    if "#" in href:
        href, frag = href.split("#", 1)
        frag = "#" + frag
    target = href
    if target.startswith(ORIGIN):
        target = target[len(ORIGIN):]
    if target.startswith("/view/"):
        p = site_path(urllib.parse.unquote(target.split("?")[0]))
        if p:
            return p + frag
    return href + frag


def is_external(href):
    return bool(re.match(r"^(https?:)?//", href or ""))


# ---------------------------------------------------------------- images

def image_key(url):
    return re.sub(r"=[a-z0-9-]+$", "", url)


def register_image(url):
    """Return the URL the site should use for a Google Sites image.

    By default images are served straight from Google's image CDN (the same
    URLs Google Sites itself uses). With --download-images they are fetched,
    converted to WebP and served from public/images instead.
    """
    if not url or "sitesv-images-rt" not in url:
        return url
    key = image_key(url)
    if key not in images:
        images[key] = key + "=w1600"
    return images[key]


def download_images(out_dir, cache):
    """Self-host every image. Needs a network Google serves images to
    (e.g. run it on your own computer); falls back to the CDN URL per image."""
    os.makedirs(out_dir, exist_ok=True)
    img_cache = os.path.join(cache, "img")
    os.makedirs(img_cache, exist_ok=True)

    def work(item):
        key, remote = item
        name = hashlib.md5(key.encode()).hexdigest()[:16] + ".webp"
        dest = os.path.join(out_dir, name)
        if not os.path.exists(dest):
            raw_fn = os.path.join(img_cache, name + ".bin")
            if not os.path.exists(raw_fn):
                r = subprocess.run(["curl", "-sSfL", "--retry", "3", "-o", raw_fn, key + "=w1920"])
                if r.returncode != 0:
                    return key, remote
            im = Image.open(raw_fn)
            im.seek(0)
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGBA")
            if im.width > 1600:
                im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
            im.save(dest, "WEBP", quality=80, method=5)
        return key, "/images/" + name

    with ThreadPoolExecutor(12) as ex:
        results = dict(ex.map(work, images.items()))
    failed = sum(1 for v in results.values() if not v.startswith("/images/"))
    if failed:
        print(f"  {failed} images could not be downloaded; they stay on Google's CDN", file=sys.stderr)
    return {v_old: results[k] for k, v_old in images.items()}


def dedupe_images(out_dir):
    """Google signs every image URL per page, so the same picture is captured
    under many names. Keep one file per picture (largest wins) and return a
    mapping from removed names to the kept one."""
    def ahash(path):
        im = Image.open(path).convert("L").resize((16, 16))
        px = list(im.getdata())
        avg = sum(px) / len(px)
        return sum(1 << i for i, v in enumerate(px) if v > avg)

    info = []
    for f in os.listdir(out_dir):
        p = os.path.join(out_dir, f)
        with Image.open(p) as im:
            w, h = im.size
        info.append((f, ahash(p), w, h))
    info.sort(key=lambda x: -x[2] * x[3])
    kept, mapping = [], {}
    for f, hsh, w, h in info:
        same = next((k for k in kept if bin(hsh ^ k[1]).count("1") <= 6 and abs(w / h - k[2] / k[3]) < 0.03), None)
        if same:
            mapping["/images/" + f] = "/images/" + same[0]
            os.remove(os.path.join(out_dir, f))
        else:
            kept.append((f, hsh, w, h))
    return mapping


def image_dims(local):
    try:
        with Image.open(os.path.join(ROOT, "public", local.lstrip("/"))) as im:
            return im.width, im.height
    except OSError:
        return None, None


# ---------------------------------------------------------------- rich text

KEEP_TAGS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "a", "br",
             "strong", "em", "u", "s", "small", "sup", "sub", "blockquote"}


def clean_text(tile):
    """Turn a Google Sites text tile into minimal semantic HTML."""
    tile = BeautifulSoup(str(tile), "html.parser").find()
    for junk in tile.select(".PPhIP, .yMxPgf, .aP9Z7e"):
        junk.decompose()

    def walk(node):
        out = []
        for child in node.children:
            if isinstance(child, NavigableString):
                out.append(html.escape(str(child), quote=False))
                continue
            if not isinstance(child, Tag):
                continue
            inner = walk(child)
            style = child.get("style", "") or ""
            name = child.name
            if name == "span" or name == "div":
                if re.search(r"font-weight:\s*(6|7|8|9)00", style):
                    inner = f"<strong>{inner}</strong>"
                if "font-style: italic" in style:
                    inner = f"<em>{inner}</em>"
                if "text-decoration: underline" in style and not child.find_parent("a"):
                    inner = f"<u>{inner}</u>"
                if "line-through" in style:
                    inner = f"<s>{inner}</s>"
                out.append(inner)
                continue
            if name == "b":
                name = "strong"
            if name == "i":
                name = "em"
            if name not in KEEP_TAGS:
                out.append(inner)
                continue
            attrs = []
            if name == "a":
                href = rewrite_href(child.get("href", ""))
                attrs.append(f'href="{html.escape(href)}"')
                if is_external(href):
                    attrs.append('target="_blank" rel="noopener"')
            if child.get("dir") in ("ltr", "rtl"):
                attrs.append(f'dir="{child["dir"]}"')
            m = re.search(r"text-align:\s*(center|left|right|justify)", style)
            if m and name not in ("a",):
                attrs.append(f'class="ta-{m.group(1)}"')
            m = re.search(r"list-style-type:\s*([a-z-]+)", style)
            if m and name in ("ul", "ol"):
                attrs.append(f'style="list-style-type:{m.group(1)}"')
            if name == "br":
                out.append("<br>")
                continue
            if name in ("h1", "h2", "h3", "h4") and child.get("id"):
                attrs.append(f'id="{html.escape(child["id"].removesuffix("_l"))}"')
            a = (" " + " ".join(attrs)) if attrs else ""
            out.append(f"<{name}{a}>{inner}</{name}>")
        return "".join(out)

    result = walk(tile)
    result = re.sub(r"</strong><strong>", "", result)
    result = re.sub(r" ", " ", result)
    if not BeautifulSoup(result, "html.parser").get_text().strip():
        return None
    return result.strip()


# ---------------------------------------------------------------- blocks

def first_width(el):
    for c in el.get("class", []):
        m = re.match(r"hJDwNd-AhqUyc-(\w+)$", c)
        if m and m.group(1) in WIDTHS:
            return WIDTHS[m.group(1)]
    return 12


def bg_url(style):
    m = re.search(r"background-image:\s*url\(([^)]+)\)", style or "")
    return m.group(1).strip("'\"") if m else None


embed_files = {}


def save_embed(code):
    h = hashlib.md5(code.encode()).hexdigest()[:16]
    rel = f"/embeds/{h}.html"
    if h not in embed_files:
        doc = code
        if "<html" not in doc.lower():
            doc = ('<!doctype html><html><head><meta charset="utf-8">'
                   '<meta name="viewport" content="width=device-width,initial-scale=1">'
                   '<style>html,body{margin:0;padding:0}</style></head><body>' + code + "</body></html>")
        embed_files[h] = doc
    return rel


def ratio_from(tile):
    pad = tile.find(style=re.compile(r"padding-top:\s*[\d.]+%"))
    if pad:
        return float(re.search(r"padding-top:\s*([\d.]+)%", pad["style"]).group(1))
    return None


def parse_tile(tile):
    t = tile.select_one(".tyJCtd")
    if t is None:
        return None
    cls = t.get("class", [])
    # text
    if "mGzaTb" in cls:
        body = clean_text(t)
        return {"type": "text", "html": body} if body else None
    # spacer
    if "KUB40b" in cls:
        h = t.find(style=re.compile("height"))
        px = int(re.search(r"height:\s*(\d+)", h["style"]).group(1)) if h else 24
        return {"type": "spacer", "height": px}
    # button
    if "N0neUc" in cls:
        a = t.find("a")
        if not a:
            return None
        href = rewrite_href(a.get("href", ""))
        return {"type": "button", "label": a.get_text(" ", strip=True), "href": href,
                "external": is_external(href)}
    # custom embed (html code)
    if "OWlOyc" in cls:
        code_el = t.find(attrs={"data-code": True})
        if code_el:
            return {"type": "embed", "src": save_embed(code_el["data-code"]),
                    "ratio": ratio_from(t) or 56.25}
        return None
    # divider
    if t.select_one(".iwQgFb"):
        return {"type": "divider"}
    # image (optionally linked)
    img = t.select_one(".t3iYD img")
    if img:
        src = register_image(img.get("src"))
        block = {"type": "image", "src": src, "alt": img.get("alt", "")}
        st = img.get("style", "")
        m = re.search(r"width:\s*([\d.]+)%;\s*margin:\s*(-?[\d.]+)%\s+0\s+(-?[\d.]+)%\s+(-?[\d.]+)%", st)
        if m and (float(m.group(1)) != 100 or any(float(m.group(i)) != 0 for i in (2, 3, 4))):
            block["crop"] = {"w": float(m.group(1)), "t": float(m.group(2)),
                             "b": float(m.group(3)), "l": float(m.group(4))}
        a = t.select_one("a.fqo2vd")
        if a:
            href = rewrite_href(a.get("href", ""))
            block["href"] = href
            block["external"] = is_external(href)
        return block
    # carousel
    car = t.select_one(".mr3rhf")
    if car:
        slides = [register_image(bg_url(s.get("style"))) for s in car.select(".nQBJnb")]
        m = re.search(r"aspect-ratio:\s*([\d.]+)\s*/\s*([\d.]+)", car.get("style", ""))
        ratio = float(m.group(1)) / float(m.group(2)) if m else 16 / 9
        return {"type": "carousel", "images": [s for s in slides if s], "ratio": ratio}
    # social links
    soc = t.select_one(".i2gjFc")
    if soc:
        links = []
        for a in soc.select("a"):
            im = a.find("img")
            links.append({"name": (im.get("alt") if im else "") or "Link",
                          "href": rewrite_href(a.get("href", ""))})
        return {"type": "social", "links": links}
    # Drive / other iframes
    fr = t.find("iframe")
    if fr and (fr.get("data-src") or fr.get("src")):
        src = fr.get("data-src") or fr.get("src")
        return {"type": "iframe", "src": src, "title": fr.get("aria-label", ""),
                "ratio": ratio_from(t) or 75}
    # empty image placeholder
    if t.select_one(".J1oeHf"):
        return {"type": "placeholder", "ratio": ratio_from(t) or 100}
    return None


def parse_section(sec):
    cls = sec.get("class", [])
    style = "default"
    for k, v in SECTION_STYLES.items():
        if k in cls:
            style = v
    if "LB7kq" in cls:
        style = "header"
    bg_el = sec.select_one(".IFuOkc")
    bg = register_image(bg_url(bg_el.get("style"))) if bg_el is not None else None
    rows = []
    for row in sec.select(".LS81yb"):
        cols = []
        for col in row.find_all(class_="JNdkSc", recursive=False):
            blocks = [b for b in (parse_tile(t) for t in col.select(".jXK9ad")) if b]
            cols.append({"span": first_width(col), "blocks": blocks})
        if any(c["blocks"] for c in cols):
            rows.append(cols)
    if not rows and not bg:
        return None
    if all(b["type"] in ("spacer", "divider") for r in rows for c in r for b in c["blocks"]) and not bg:
        return None
    return {"style": style, "bg": bg, "rows": rows}


def parse_nav(soup):
    nav = soup.select_one("nav#yuynLe ul.jYxBte")

    def walk(ul):
        items = []
        for li in ul.find_all("li", recursive=False):
            a = li.select_one(".I35ICb a")
            if not a:
                continue
            href = rewrite_href(a.get("href", ""))
            item = {"label": a.get_text(strip=True), "href": href, "external": is_external(href)}
            sub = li.select_one("ul.VcS63b")
            if sub:
                item["children"] = walk(sub)
            items.append(item)
        return items

    return walk(nav) if nav else []


def page_title(soup, site_title):
    t = soup.title.get_text(strip=True) if soup.title else site_title
    if t.startswith(site_title + " - "):
        t = t[len(site_title) + 3:]
    return t


def css_color(css, pattern):
    m = re.search(pattern, css)
    if not m:
        return None
    r, g, b = [int(x) for x in re.findall(r"\d+", m.group(1))[:3]]
    return f"#{r:02x}{g:02x}{b:02x}"


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(ROOT, ".cache", "google-sites"))
    ap.add_argument("--download-images", action="store_true",
                    help="self-host images in public/images instead of using Google's CDN")
    args = ap.parse_args()

    print("Crawling…", file=sys.stderr)
    order, raw = crawl(args.cache)

    sites, pages = {}, []
    for gid, (base, key) in SITES.items():
        soup = BeautifulSoup(raw[f"/view/{gid}/home"], "html.parser")
        css = " ".join(s.get_text() for s in soup.find_all("style"))
        title = soup.select_one("a.Zjiec span").get_text(strip=True)
        logo = soup.select_one("a.XMyrgf img")
        footer = soup.find("footer")
        sites[key] = {
            "key": key,
            "base": base or "/",
            "googleUrl": f"{ORIGIN}/view/{gid}/home",
            "title": title,
            "logo": register_image(logo["src"]) if logo else None,
            "accent": css_color(css, r"\.lQAHbd:before\{background-color: ([^;]+);"),
            "nav": parse_nav(soup),
            "footer": [s for s in (parse_section(x) for x in footer.find_all("section")) if s] if footer else [],
        }

    for p in order:
        gid = p.split("/")[2]
        key = SITES[gid][1]
        soup = BeautifulSoup(raw[p], "html.parser")
        for s in soup(["script", "noscript"]):
            s.decompose()
        footer = soup.find("footer")
        if footer:
            footer.decompose()
        header_el = soup.find(id="atIdViewHeader")
        if header_el:
            header_el.decompose()
        sections = [s for s in (parse_section(x) for x in soup.find_all("section")) if s]
        desc = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
        pages.append({
            "site": key,
            "path": site_path(p),
            "source": ORIGIN + urllib.parse.quote(p),
            "title": page_title(soup, sites[key]["title"]),
            "description": (desc.get("content", "").strip() if desc else ""),
            "sections": sections,
        })

    if args.download_images:
        print(f"Downloading {len(images)} images…", file=sys.stderr)
        mapping = download_images(os.path.join(ROOT, "public", "images"), args.cache)
        merged = dedupe_images(os.path.join(ROOT, "public", "images"))
        mapping = {k: merged.get(v, v) for k, v in mapping.items()}

        def swap(obj):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if isinstance(v, str) and v in mapping:
                        obj[k] = mapping[v]
                    else:
                        swap(v)
                if obj.get("type") == "image" and obj.get("src", "").startswith("/images/"):
                    obj["width"], obj["height"] = image_dims(obj["src"])
            elif isinstance(obj, list):
                for i, v in enumerate(obj):
                    if isinstance(v, str) and v in mapping:
                        obj[i] = mapping[v]
                    else:
                        swap(v)
        swap(pages)
        swap(sites)

    embed_dir = os.path.join(ROOT, "public", "embeds")
    os.makedirs(embed_dir, exist_ok=True)
    for h, doc in embed_files.items():
        with open(os.path.join(embed_dir, h + ".html"), "w", encoding="utf-8") as f:
            f.write(doc)

    data_dir = os.path.join(ROOT, "src", "data")
    os.makedirs(data_dir, exist_ok=True)
    with open(os.path.join(data_dir, "sites.json"), "w", encoding="utf-8") as f:
        json.dump(sites, f, ensure_ascii=False, indent=1)
    with open(os.path.join(data_dir, "pages.json"), "w", encoding="utf-8") as f:
        json.dump(pages, f, ensure_ascii=False, indent=1)
    print(f"Done: {len(pages)} pages, {len(images)} images, {len(embed_files)} embeds", file=sys.stderr)


if __name__ == "__main__":
    main()
