#!/usr/bin/env python3
"""文献を文献DBに登録する。

    python scripts/add_reference.py --doi 10.1016/0304-405X(93)90023-5
    python scripts/add_reference.py --isbn 9784502370311
    python scripts/add_reference.py --json ref.json          # 手入力（未検証で登録）
    python scripts/add_reference.py --doi ... --assignment reports/2026-秋/財務会計_のれんの減損

DOI・ISBN の照会が成功したものだけが「出典検証済」になる。手入力は未検証のまま残り、
push_final.py がそれを最終稿に出さない。
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib import citation, config, notion, refs  # noqa: E402

TEXT_FIELDS = ["著者", "筆頭著者姓", "掲載誌・書名", "巻", "号", "ページ", "出版社",
               "出版地", "ISBN", "WP番号", "基準番号・条文", "適用時点", "企業名",
               "証券コード", "対象期間", "要約", "引用可能箇所"]
SELECT_FIELDS = ["種別", "言語", "データ出典元", "評価", "登録元"]


def to_properties(ref):
    props = {"タイトル": notion.title(ref.get("タイトル", ""))}
    for f in TEXT_FIELDS:
        if ref.get(f) not in (None, ""):
            props[f] = notion.text(ref[f])
    for f in SELECT_FIELDS:
        if ref.get(f) not in (None, ""):
            props[f] = notion.select(ref[f])
    if ref.get("発行年"):
        props["発行年"] = notion.number(ref["発行年"])
    for f in ("DOI", "参照URL"):
        if ref.get(f):
            props[f] = notion.url(ref[f])
    if ref.get("参照日"):
        props["参照日"] = notion.date(ref["参照日"])
    if ref.get("使用先章"):
        props["使用先章"] = notion.multi_select(ref["使用先章"])
    props["出典検証済"] = notion.checkbox(ref.get("出典検証済", False))
    return props


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--doi")
    g.add_argument("--isbn")
    g.add_argument("--json", help="文献DBのプロパティ名をキーにした JSON ファイル")
    ap.add_argument("--assignment", help="この課題ディレクトリの meta.json に紐付ける")
    ap.add_argument("--chapter", action="append", help="卒論の使用先章（複数可）")
    args = ap.parse_args()

    if args.doi:
        ref = refs.from_doi(args.doi)
    elif args.isbn:
        ref = refs.from_isbn(args.isbn)
    else:
        ref = json.loads(Path(args.json).read_text(encoding="utf-8"))
        ref.setdefault("登録元", "手動")
        ref.setdefault("出典検証済", False)
    if args.chapter:
        ref["使用先章"] = args.chapter

    page = notion.create_page(config.DB_REFERENCES, to_properties(ref))
    mark = "検証済" if ref.get("出典検証済") else "未検証（最終稿には出力されません）"
    print(f"登録しました [{mark}]: {citation.format_apa(ref)}")
    print(f"Notion: {page['url']}")

    if args.assignment:
        meta_path = Path(args.assignment) / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        ids = meta.setdefault("reference_page_ids", [])
        if page["id"] not in ids:
            ids.append(page["id"])
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
                             encoding="utf-8")
        print(f"紐付けました: {meta_path}")


if __name__ == "__main__":
    main()
