#!/usr/bin/env python3
"""課題を Notion の課題DBと Git の作業ディレクトリの両方に作る。

    python scripts/new_assignment.py --subject 財務会計 --title "のれんの減損" \
        --term 2026-秋 --due 2026-10-20 --chars 4000 --style APA
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib import config, notion  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--subject", required=True, help="科目")
    ap.add_argument("--title", required=True, help="課題名")
    ap.add_argument("--term", required=True, help="年度学期（例 2026-秋）")
    ap.add_argument("--due", help="締切 YYYY-MM-DD")
    ap.add_argument("--chars", type=int, help="指定字数")
    ap.add_argument("--style", default="指定なし",
                    choices=["APA", "SIST02", "シカゴ", "MLA", "指定なし"])
    ap.add_argument("--teacher", default="", help="担当教員")
    ap.add_argument("--requirements", default="", help="設問文")
    args = ap.parse_args()

    workdir = Path(config.REPORTS_DIR) / args.term / f"{args.subject}_{args.title}"
    if workdir.exists():
        sys.exit(f"すでに存在します: {workdir}")
    workdir.mkdir(parents=True)

    page = notion.create_page(config.DB_ASSIGNMENTS, {
        "課題名": notion.title(args.title),
        "科目": notion.select(args.subject),
        "年度学期": notion.select(args.term),
        "締切": notion.date(args.due),
        "ステータス": notion.select("未着手"),
        "指定字数": notion.number(args.chars),
        "引用形式": notion.select(args.style),
        "担当教員": notion.text(args.teacher),
        "課題要件": notion.text(args.requirements),
        "Gitパス": notion.text(str(workdir)),
    })

    (workdir / "assignment.md").write_text(
        f"# {args.title}\n\n"
        f"- 科目: {args.subject}\n- 担当教員: {args.teacher}\n"
        f"- 締切: {args.due or '未定'}\n- 指定字数: {args.chars or '未定'}\n"
        f"- 引用形式: {args.style}\n\n## 設問\n\n{args.requirements}\n",
        encoding="utf-8")
    (workdir / "draft.md").write_text("", encoding="utf-8")
    (workdir / "final.md").write_text("", encoding="utf-8")
    (workdir / "meta.json").write_text(json.dumps({
        "notion_page_id": page["id"],
        "subject": args.subject,
        "title": args.title,
        "term": args.term,
        "citation_style": args.style,
        "model": None,
        "generated_at": None,
        "instruction_summary": None,
        "reference_page_ids": [],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"作成しました: {workdir}")
    print(f"Notion: {page['url']}")


if __name__ == "__main__":
    main()
