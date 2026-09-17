"""DOI・ISBN からの書誌取得。

ここで取得できた文献だけが「出典検証済」になる。手入力した文献は、PDF 実物を
確認するまで未検証のまま残す。存在しない文献が最終稿に混ざるのを防ぐ要。
"""
import json
import urllib.parse
import urllib.request

UA = "claude-report-system (mailto:noreply@example.com)"

CROSSREF_TYPE = {
    "journal-article": "学術論文",
    "proceedings-article": "学術論文",
    "book": "書籍",
    "monograph": "書籍",
    "book-chapter": "書籍章",
    "posted-content": "ワーキングペーパー",
    "report": "実務レポート",
}


class LookupError_(RuntimeError):
    pass


def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read())


def _is_japanese(s):
    return any("぀" <= c <= "ヿ" or "一" <= c <= "鿿" for c in s or "")


def from_doi(doi):
    """CrossRef から書誌を引く。見つかれば出典検証済で返す。"""
    doi = doi.strip().replace("https://doi.org/", "").replace("doi:", "")
    try:
        msg = _get_json(f"https://api.crossref.org/works/{urllib.parse.quote(doi)}")["message"]
    except Exception as e:
        raise LookupError_(f"DOI が CrossRef で見つかりません: {doi} ({e})") from e

    authors = "; ".join(
        f"{a.get('family', '')}, {a.get('given', '')}".strip(", ")
        for a in msg.get("author", []) if a.get("family")
    )
    parts = (msg.get("published-print") or msg.get("published-online")
             or msg.get("issued") or {}).get("date-parts", [[None]])
    year = parts[0][0] if parts and parts[0] else None
    title = (msg.get("title") or [""])[0]
    container = (msg.get("container-title") or [""])[0]

    return {
        "タイトル": title,
        "著者": authors,
        "筆頭著者姓": authors.split(",")[0] if authors else "",
        "発行年": year,
        "種別": CROSSREF_TYPE.get(msg.get("type"), "学術論文"),
        "掲載誌・書名": container,
        "巻": msg.get("volume", ""),
        "号": msg.get("issue", ""),
        "ページ": msg.get("page", ""),
        "出版社": msg.get("publisher", ""),
        "DOI": f"https://doi.org/{doi}",
        "言語": "和文" if _is_japanese(title + authors) else "英文",
        "出典検証済": True,
        "登録元": "DOI自動",
    }


def from_isbn(isbn):
    """和書は openBD、見つからなければ Google Books を引く。"""
    isbn = isbn.replace("-", "").strip()
    try:
        data = _get_json(f"https://api.openbd.jp/v1/get?isbn={isbn}")
        if data and data[0]:
            s = data[0].get("summary", {})
            authors = "; ".join(a.strip() for a in (s.get("author") or "").split("/") if a.strip())
            return {
                "タイトル": s.get("title", ""),
                "著者": authors,
                "筆頭著者姓": authors.split(",")[0] if authors else "",
                "発行年": int((s.get("pubdate") or "0")[:4] or 0) or None,
                "種別": "書籍",
                "出版社": s.get("publisher", ""),
                "ISBN": isbn,
                "言語": "和文",
                "出典検証済": True,
                "登録元": "DOI自動",
            }
    except Exception:
        pass

    try:
        res = _get_json(f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}")
        items = res.get("items") or []
        if not items:
            raise LookupError_(f"ISBN が見つかりません: {isbn}")
        v = items[0]["volumeInfo"]
        authors = "; ".join(v.get("authors", []))
        return {
            "タイトル": v.get("title", ""),
            "著者": authors,
            "筆頭著者姓": authors.split(",")[0] if authors else "",
            "発行年": int((v.get("publishedDate") or "0")[:4] or 0) or None,
            "種別": "書籍",
            "出版社": v.get("publisher", ""),
            "ISBN": isbn,
            "言語": "和文" if _is_japanese(v.get("title", "")) else "英文",
            "出典検証済": True,
            "登録元": "DOI自動",
        }
    except LookupError_:
        raise
    except Exception as e:
        raise LookupError_(f"ISBN の照会に失敗しました: {isbn} ({e})") from e
