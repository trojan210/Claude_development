"""Notion のオブジェクト ID と環境変数。ID は NOTION.md と同期させること。"""
import os

NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "")
NOTION_VERSION = "2022-06-28"

PAGE_UNIVERSITY = "3de13e6b-38c9-8132-a673-c1a3cf261510"
PAGE_THESIS = "3de13e6b-38c9-8153-af14-f5051666787b"
PAGE_OPS_MEMO = "3de13e6b-38c9-8146-8f04-ef9fc3f48444"

DB_ASSIGNMENTS = "98c4d8b2-0b5c-4c58-b97b-ee3b465446c1"
DB_REFERENCES = "e633674a-daf2-4c2e-bea3-dc7b0fd8a16f"

REPORTS_DIR = "reports"
THESIS_DIR = "thesis"

# 課題DB「引用形式」が「指定なし」のときに使う既定の形式。
DEFAULT_CITATION_STYLE = "APA"
