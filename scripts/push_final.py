#!/usr/bin/env python3
"""確定版を Notion に書き込む。

    python scripts/push_final.py reports/2026-秋/財務会計_のれんの減損 \
        --model claude-opus-5 --instruction "設問文と指定文献を渡して初稿を生成、自分で加筆修正"

出典検証済でない文献が紐付いている場合は、書き込みを行わずに中止する。
存在しない文献が最終稿に混ざるのを機械的に防ぐための関門であり、外してはならない。
"""
import argparse
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib import citation, config, notion  # noqa: E402


def count_chars(text):
    """空白・改行を除いた字数。日本語レポートの字数指定はこの数え方に近い。"""
    body = re.sub(r"^#.*$", "", text, flags=re.MULTILINE)   # 見出しは数えない
    return len(re.sub(r"\s", "", body))


def git_head():
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True,
                              text=True, check=True).stdout.strip()
    except Exception:
        return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("assignment", help="課題ディレクトリ")
    ap.add_argument("--model", help="使用モデル（meta.json を上書き）")
    ap.add_argument("--instruction", help="指示概要（AI 利用申告用）")
    ap.add_argument("--status", default="確定",
                    choices=["確定", "提出済", "推敲中", "固め"])
    ap.add_argument("--submitted", help="提出日 YYYY-MM-DD")
    args = ap.parse_args()

    workdir = Path(args.assignment)
    meta = json.loads((workdir / "meta.json").read_text(encoding="utf-8"))
    final = (workdir / "final.md").read_text(encoding="utf-8").strip()
    if not final:
        sys.exit("final.md が空です")

    page_id = meta["notion_page_id"]
    style = meta.get("citation_style") or config.DEFAULT_CITATION_STYLE
    if style == "指定なし":
        style = config.DEFAULT_CITATION_STYLE

    # --- 出典検証の関門 ---------------------------------------------------
    ref_ids = meta.get("reference_page_ids", [])
    ref_pages = [notion.get_page(i) for i in ref_ids]
    ref_dicts = [notion.reference_dict(p) for p in ref_pages]
    unverified = [r for r in ref_dicts if not r.get("出典検証済")]
    if unverified:
        print("出典検証済でない文献があるため中止します。DOI 照会か PDF 実物で確認してください。",
              file=sys.stderr)
        for r in unverified:
            print(f"  - {r.get('タイトル')} / {r.get('著者')}", file=sys.stderr)
        sys.exit(1)

    # --- 本文 + 参考文献一覧 ---------------------------------------------
    body = final
    if ref_dicts:
        entries = citation.bibliography(ref_dicts, style)
        body += "\n\n## 参考文献\n\n" + "\n".join(f"- {e}" for e in entries)

    chars = count_chars(final)
    notion.replace_content(page_id, notion.markdown_to_blocks(body))

    props = {
        "実字数": notion.number(chars),
        "ステータス": notion.select(args.status),
        "確定コミット": notion.text(git_head()),
        "Gitパス": notion.text(str(workdir)),
    }
    if ref_ids:
        props["参考文献"] = notion.relation(ref_ids)

    model = args.model or meta.get("model")
    instruction = args.instruction or meta.get("instruction_summary")
    if model:
        props["使用モデル"] = notion.select(model)
        meta["model"] = model
    if instruction:
        props["指示概要"] = notion.text(instruction)
        meta["instruction_summary"] = instruction
    if model or instruction:
        generated = meta.get("generated_at") or date.today().isoformat()
        props["生成日時"] = notion.date(generated)
        meta["generated_at"] = generated
    if args.submitted:
        props["提出日"] = notion.date(args.submitted)

    notion.update_page(page_id, props)
    (workdir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
                                       encoding="utf-8")

    print(f"書き込みました: {chars} 字 / 文献 {len(ref_dicts)} 件 / 形式 {style}")
    if not model or not instruction:
        print("注意: 使用モデルまたは指示概要が未記録です。AI 利用申告を求められた際に"
              "遡って作れないため、--model と --instruction を指定してください。")


if __name__ == "__main__":
    main()
