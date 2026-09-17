"""PDF からのテキスト抽出。

書誌情報と要約の生成そのものは Claude が行う。このモジュールは抽出だけを担い、
決定的な部分（どのページから何文字取るか）をスクリプト側に固定する。
"""
from pathlib import Path


def extract_text(pdf_path, max_pages=None):
    try:
        from pypdf import PdfReader
    except ImportError as e:
        raise RuntimeError("pypdf が必要です: pip install -r requirements.txt") from e

    reader = PdfReader(str(pdf_path))
    pages = reader.pages if max_pages is None else reader.pages[:max_pages]
    return "\n\n".join(p.extract_text() or "" for p in pages)


def front_matter(pdf_path, pages=2):
    """書誌情報の抽出用に冒頭数ページだけを返す。"""
    return extract_text(pdf_path, max_pages=pages)


def summary_prompt(pdf_path, pages=2):
    """Claude に渡す抽出プロンプト。判断は Claude、抽出はここ、と分ける。"""
    head = front_matter(pdf_path, pages)
    return f"""次は論文 PDF の冒頭 {pages} ページのテキストです。ここから書誌情報を抽出し、
文献DB のプロパティ名をキーにした JSON で返してください。

- キー: タイトル, 著者（「姓, 名; 姓, 名」形式）, 筆頭著者姓, 発行年, 種別,
  掲載誌・書名, 巻, 号, ページ, 出版社, DOI, 言語, 要約
- 要約は 200 字程度で、この論文の問いと結論を書くこと
- テキストから読み取れない項目は空文字にすること。推測して埋めないこと

ファイル: {Path(pdf_path).name}

---
{head[:12000]}
"""
