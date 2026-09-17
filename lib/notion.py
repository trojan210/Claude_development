"""Notion API の薄いクライアント。requests のみに依存する。"""
import json
import urllib.request
import urllib.error

from . import config

API = "https://api.notion.com/v1"


class NotionError(RuntimeError):
    pass


def _request(method, path, payload=None):
    if not config.NOTION_TOKEN:
        raise NotionError("NOTION_TOKEN が設定されていません")
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {config.NOTION_TOKEN}")
    req.add_header("Notion-Version", config.NOTION_VERSION)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        raise NotionError(f"{e.code} {e.read().decode(errors='replace')}") from e


# --- プロパティ値の組み立て ---------------------------------------------

def title(v):
    return {"title": [{"text": {"content": str(v)[:2000]}}]}


def text(v):
    if v in (None, ""):
        return {"rich_text": []}
    return {"rich_text": [{"text": {"content": str(v)[:2000]}}]}


def number(v):
    return {"number": None if v in (None, "") else float(v)}


def select(v):
    return {"select": None if v in (None, "") else {"name": str(v)}}


def multi_select(vs):
    return {"multi_select": [{"name": str(v)} for v in (vs or [])]}


def date(v):
    return {"date": None if v in (None, "") else {"start": str(v)}}


def url(v):
    return {"url": None if v in (None, "") else str(v)}


def checkbox(v):
    return {"checkbox": bool(v)}


def relation(ids):
    return {"relation": [{"id": i} for i in (ids or [])]}


# --- ページ操作 ----------------------------------------------------------

def create_page(database_id, properties, children=None):
    payload = {"parent": {"database_id": database_id}, "properties": properties}
    if children:
        payload["children"] = children[:100]
    return _request("POST", "/pages", payload)


def update_page(page_id, properties):
    return _request("PATCH", f"/pages/{page_id}", {"properties": properties})


def append_blocks(page_id, children):
    """100 ブロックずつに分割して追記する。"""
    for i in range(0, len(children), 100):
        _request("PATCH", f"/blocks/{page_id}/children", {"children": children[i:i + 100]})


def query_database(database_id, filter_=None, page_size=100):
    payload = {"page_size": page_size}
    if filter_:
        payload["filter"] = filter_
    results, cursor = [], None
    while True:
        if cursor:
            payload["start_cursor"] = cursor
        res = _request("POST", f"/databases/{database_id}/query", payload)
        results.extend(res.get("results", []))
        if not res.get("has_more"):
            return results
        cursor = res.get("next_cursor")


def plain(prop):
    """rich_text / title プロパティを素の文字列にする。"""
    items = prop.get("rich_text") or prop.get("title") or []
    return "".join(i.get("plain_text", "") for i in items)


# --- Markdown → ブロック -------------------------------------------------

def markdown_to_blocks(md):
    """見出し・箇条書き・段落だけを扱う簡易変換。レポート本文にはこれで足りる。"""
    blocks = []
    for raw in md.split("\n"):
        line = raw.rstrip()
        if not line.strip():
            continue
        if line.startswith("### "):
            blocks.append(_block("heading_3", line[4:]))
        elif line.startswith("## "):
            blocks.append(_block("heading_2", line[3:]))
        elif line.startswith("# "):
            blocks.append(_block("heading_1", line[2:]))
        elif line.lstrip().startswith(("- ", "* ")):
            blocks.append(_block("bulleted_list_item", line.lstrip()[2:]))
        else:
            blocks.append(_block("paragraph", line))
    return blocks


def _block(kind, content):
    # Notion のリッチテキストは 1 要素 2000 文字まで。長い段落は分割する。
    chunks = [content[i:i + 1900] for i in range(0, len(content), 1900)] or [""]
    return {
        "object": "block",
        "type": kind,
        kind: {"rich_text": [{"type": "text", "text": {"content": c}} for c in chunks]},
    }


def get_page(page_id):
    return _request("GET", f"/pages/{page_id}")


def list_children(block_id):
    results, cursor = [], None
    while True:
        q = f"?page_size=100" + (f"&start_cursor={cursor}" if cursor else "")
        res = _request("GET", f"/blocks/{block_id}/children{q}")
        results.extend(res.get("results", []))
        if not res.get("has_more"):
            return results
        cursor = res.get("next_cursor")


def delete_block(block_id):
    return _request("DELETE", f"/blocks/{block_id}")


def replace_content(page_id, blocks):
    """既存の本文を消してから書き込む。再実行しても内容が重複しない。"""
    for child in list_children(page_id):
        delete_block(child["id"])
    append_blocks(page_id, blocks)


def prop_value(page, name):
    """ページのプロパティを Python の素の値として取り出す。"""
    p = (page.get("properties") or {}).get(name)
    if not p:
        return None
    t = p.get("type")
    if t in ("title", "rich_text"):
        return plain(p)
    if t == "number":
        return p.get("number")
    if t == "select":
        return (p.get("select") or {}).get("name")
    if t == "multi_select":
        return [o["name"] for o in p.get("multi_select", [])]
    if t == "date":
        return (p.get("date") or {}).get("start")
    if t == "checkbox":
        return p.get("checkbox")
    if t == "url":
        return p.get("url")
    if t == "relation":
        return [r["id"] for r in p.get("relation", [])]
    return None


def reference_dict(page):
    """文献DBのページを citation.py が扱える dict にする。"""
    names = ["タイトル", "著者", "筆頭著者姓", "発行年", "種別", "掲載誌・書名", "巻", "号",
             "ページ", "出版社", "出版地", "DOI", "ISBN", "参照URL", "参照日", "言語",
             "WP番号", "基準番号・条文", "適用時点", "企業名", "証券コード", "対象期間",
             "データ出典元", "要約", "引用可能箇所", "評価", "出典検証済", "登録元"]
    return {n: prop_value(page, n) for n in names}
