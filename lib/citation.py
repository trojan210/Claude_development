"""引用文字列の整形。

文献DBは引用形式に依存しない生データのみを保持し、APA / SIST02 などの文字列は
ここで都度組み立てる。これにより同じ文献を形式違いで重複登録せずに済む。

ref は文献DBのプロパティ名をそのままキーにした dict を想定する。
"""

APA = "APA"
SIST02 = "SIST02"


# --- 著者 ----------------------------------------------------------------

def split_authors(s):
    """'姓, 名; 姓, 名' を [(姓, 名), ...] に分解する。"""
    out = []
    for part in (s or "").split(";"):
        part = part.strip()
        if not part:
            continue
        if "," in part:
            family, given = part.split(",", 1)
            out.append((family.strip(), given.strip()))
        else:
            out.append((part, ""))
    return out


def _is_japanese(s):
    return any("぀" <= c <= "ヿ" or "一" <= c <= "鿿" for c in s or "")


def _initials(given):
    return " ".join(f"{p[0]}." for p in given.replace(".", " ").split() if p)


def format_authors_apa(author_str, lang=None):
    """APA の著者欄。和文は「姓名・姓名」、英文は 'Family, G., & Family, G.'。"""
    authors = split_authors(author_str)
    if not authors:
        return ""
    japanese = (lang == "和文") if lang else _is_japanese(author_str)

    if japanese:
        names = [f"{fam}{giv}" for fam, giv in authors]
        return "・".join(names)

    names = [f"{fam}, {_initials(giv)}".rstrip(", ") for fam, giv in authors]
    if len(names) == 1:
        return names[0]
    if len(names) <= 20:
        return ", ".join(names[:-1]) + ", & " + names[-1]
    # APA は 21 名以上を「先頭 19 名 … 最終著者」で示す
    return ", ".join(names[:19]) + ", ... " + names[-1]


def in_text(ref):
    """本文中の引用表記。例: (Fama & French, 1993) / (伊藤, 2020)"""
    authors = split_authors(ref.get("著者"))
    year = ref.get("発行年") or "n.d."
    japanese = (ref.get("言語") == "和文") or _is_japanese(ref.get("著者", ""))
    if not authors:
        # 開示資料・統計・基準は著者欄が空になる。発行主体を著者の位置に置く。
        issuer = (ref.get("企業名") or ref.get("データ出典元")
                  or ref.get("出版社") or ref.get("タイトル") or "")
        return f"({issuer}, {year})"
    fams = [a[0] for a in authors]
    joiner = "・" if japanese else " & "
    if len(fams) == 1:
        head = fams[0]
    elif len(fams) == 2:
        head = joiner.join(fams)
    else:
        head = fams[0] + ("ほか" if japanese else " et al.")
    return f"({head}, {year})"


# --- 書誌 ----------------------------------------------------------------

def _joined(parts, sep=" "):
    return sep.join(p for p in parts if p)


def _retrieved(ref):
    accessed, link = ref.get("参照日"), ref.get("参照URL") or ref.get("DOI")
    if not link:
        return ""
    if accessed:
        return f"{accessed} 取得, {link}"
    return link


def format_apa(ref):
    """種別ごとに APA 準拠の参考文献エントリを組み立てる。"""
    kind = ref.get("種別") or "学術論文"
    authors = format_authors_apa(ref.get("著者"), ref.get("言語"))
    year = ref.get("発行年") or "n.d."
    t = ref.get("タイトル") or ""
    head = f"{authors} ({year}). {t}." if authors else f"{t} ({year})."

    if kind == "学術論文":
        vol = ref.get("巻") or ""
        num = f"({ref['号']})" if ref.get("号") else ""
        loc = _joined([f"{ref.get('掲載誌・書名', '')}", f"{vol}{num}"], ", ").strip(", ")
        tail = _joined([loc, ref.get("ページ")], ", ")
        doi = f" https://doi.org/{ref['DOI'].split('doi.org/')[-1]}" if ref.get("DOI") else ""
        return f"{head} {tail}.{doi}".replace("  ", " ").strip()

    if kind == "ワーキングペーパー":
        # 未公刊であることを明示しないと、査読済論文と誤読される
        wp = ref.get("WP番号") or ""
        label = f"（{wp}）" if wp else ""
        return f"{head} {label}［ワーキングペーパー・未公刊］. {_retrieved(ref)}".strip()

    if kind == "書籍":
        return f"{head} {_joined([ref.get('出版地'), ref.get('出版社')], ': ')}.".strip()

    if kind == "書籍章":
        pages = f" (pp. {ref['ページ']})" if ref.get("ページ") else ""
        return (f"{head} {ref.get('掲載誌・書名', '')}{pages}. "
                f"{_joined([ref.get('出版地'), ref.get('出版社')], ': ')}.").strip()

    if kind == "会計基準・実務指針":
        # 基準は改正されるため、適用時点の明示が引用の成否を分ける
        std = ref.get("基準番号・条文") or ""
        applied = f"（{ref['適用時点']}時点）" if ref.get("適用時点") else ""
        issuer = ref.get("出版社") or ""
        return f"{issuer} ({year}). {_joined([std, t], ' ')}{applied}. {_retrieved(ref)}".strip()

    if kind == "法令・判例":
        return f"{_joined([t, ref.get('基準番号・条文')], ' ')} ({year}).".strip()

    if kind == "企業開示資料":
        code = f"（証券コード {ref['証券コード']}）" if ref.get("証券コード") else ""
        period = f" {ref['対象期間']}" if ref.get("対象期間") else ""
        return f"{ref.get('企業名', '')} ({year}). {t}{period}{code}. {_retrieved(ref)}".strip()

    if kind == "統計・データベース":
        src = ref.get("データ出典元") or ref.get("出版社") or ""
        period = f"（{ref['対象期間']}）" if ref.get("対象期間") else ""
        return f"{src} ({year}). {t}［データセット］{period}. {_retrieved(ref)}".strip()

    # 実務レポート / Web / 新聞
    outlet = ref.get("掲載誌・書名") or ref.get("出版社") or ""
    return f"{head} {outlet}. {_retrieved(ref)}".strip().replace(" . ", " ")


def format_sist02(ref, index=None):
    """SIST02 の番号引用。APA 実装後の追加分で、主要な種別のみ対応する。"""
    n = f"{index}) " if index is not None else ""
    authors = "・".join(f"{f}{g}" for f, g in split_authors(ref.get("著者")))
    t = ref.get("タイトル") or ""
    if (ref.get("種別") or "") == "学術論文":
        tail = _joined([ref.get("掲載誌・書名"), ref.get("巻"), ref.get("号"), ref.get("ページ")], ", ")
        return f"{n}{authors}. {t}. {tail}, {ref.get('発行年', '')}.".replace(" ,", ",")
    return f"{n}{authors}. {t}. {_joined([ref.get('出版社'), str(ref.get('発行年', ''))], ', ')}."


def format_reference(ref, style=APA, index=None):
    if style == SIST02:
        return format_sist02(ref, index)
    return format_apa(ref)


def bibliography(refs, style=APA):
    """参考文献一覧。APA は筆頭著者姓の昇順、SIST02 は登録順に番号を振る。"""
    if style == SIST02:
        return [format_sist02(r, i + 1) for i, r in enumerate(refs)]
    ordered = sorted(refs, key=lambda r: (r.get("筆頭著者姓") or r.get("著者") or ""))
    return [format_apa(r) for r in ordered]
