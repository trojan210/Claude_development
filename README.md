# claude_development

大学レポート・卒業論文の作成支援システム。専攻はコーポレートファイナンス／会計学。

Claude Code セッションをオペレーターとし、決定的な処理（Notion 書き込み・DOI 照会・引用整形・字数計算）は
このリポジトリのスクリプトに切り出す。草稿は Git で版管理し、Notion には確定版のみを保管する。

- 要件と設計: [SPEC.md](./SPEC.md)
- Notion 側の構成と ID: [NOTION.md](./NOTION.md)

## 構成

```
lib/        共通ライブラリ（Notion クライアント・引用整形・書誌取得・PDF 抽出）
scripts/    CLI エントリポイント
prompts/    レポート生成の定型プロンプト
reports/    <年度学期>/<科目>_<課題名>/ ごとの課題要件・草稿・確定版
thesis/     卒業論文の章本文（chNN.md）
analysis/   実証分析のデータ加工・推定コード
```

## 使い方

```bash
pip install -r requirements.txt
export NOTION_TOKEN=...          # Notion インテグレーショントークン

python scripts/new_assignment.py --subject 財務会計 --title "のれんの減損" --term 2026-秋 --due 2026-10-20 --chars 4000
python scripts/add_reference.py --doi 10.1111/j.1540-6261.1997.tb03808.x
python scripts/push_final.py reports/2026-秋/財務会計_のれんの減損
```

## 原則

1. 草稿は Git、Notion は確定版のみ
2. 文献DBは引用形式に依存しない生データのみを保持し、引用文字列は `lib/citation.py` が整形する
3. **出典検証済でない文献は最終稿に出力しない**（`push_final.py` が機械的に検査して中止する）
4. 生成には使用モデル・日時・指示概要を必ず記録する
