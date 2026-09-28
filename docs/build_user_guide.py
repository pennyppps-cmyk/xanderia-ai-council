"""Builds docs/Xanderia-AI-Council-User-Guide.pdf  (python docs/build_user_guide.py)

Screenshots live in docs/guide-images/ (captured from the running app with Playwright).
"""
from pathlib import Path

from PIL import Image as PILImage
from reportlab.graphics.shapes import Circle, Drawing, Line, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    CondPageBreak, Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

HERE = Path(__file__).parent
IMG = HERE / "guide-images"
FONTS = Path("C:/Windows/Fonts")
pdfmetrics.registerFont(TTFont("Sans", str(FONTS / "segoeui.ttf")))
pdfmetrics.registerFont(TTFont("Sans-Bold", str(FONTS / "segoeuib.ttf")))
pdfmetrics.registerFont(TTFont("Sans-Italic", str(FONTS / "segoeuii.ttf")))
pdfmetrics.registerFontFamily("Sans", normal="Sans", bold="Sans-Bold", italic="Sans-Italic", boldItalic="Sans-Bold")

INK = colors.HexColor("#0f2a3d")
INK2 = colors.HexColor("#3b556a")
MUTED = colors.HexColor("#7890a3")
LINE = colors.HexColor("#e3eaef")
BG = colors.HexColor("#f3f6f8")
TEAL = colors.HexColor("#0d9488")
TEAL_BG = colors.HexColor("#effcf9")
TEAL_LIGHT = colors.HexColor("#5eead4")
AMBER_BG = colors.HexColor("#fffbeb")
W = 170 * mm

S = {
    "h1": ParagraphStyle("h1", fontName="Sans-Bold", fontSize=20, leading=25, textColor=INK, spaceAfter=6),
    "h2": ParagraphStyle("h2", fontName="Sans-Bold", fontSize=13.5, leading=18, textColor=INK, spaceBefore=12, spaceAfter=4),
    "h3": ParagraphStyle("h3", fontName="Sans-Bold", fontSize=9, leading=12, textColor=TEAL, spaceBefore=6, spaceAfter=2),
    "lead": ParagraphStyle("lead", fontName="Sans", fontSize=11, leading=16, textColor=INK2, spaceAfter=6),
    "body": ParagraphStyle("body", fontName="Sans", fontSize=9.5, leading=14, textColor=INK2),
    "small": ParagraphStyle("small", fontName="Sans", fontSize=8, leading=11, textColor=MUTED),
    "caption": ParagraphStyle("caption", fontName="Sans-Italic", fontSize=8, leading=11, textColor=MUTED, spaceBefore=3, spaceAfter=8),
    "step": ParagraphStyle("step", fontName="Sans", fontSize=9.5, leading=13.5, textColor=INK2, leftIndent=16, bulletIndent=0, spaceAfter=3),
    "bullet": ParagraphStyle("bullet", fontName="Sans", fontSize=9.5, leading=13.5, textColor=INK2, leftIndent=11, bulletIndent=0, spaceAfter=2),
    "cell": ParagraphStyle("cell", fontName="Sans", fontSize=8.6, leading=11.8, textColor=INK2),
    "cellb": ParagraphStyle("cellb", fontName="Sans-Bold", fontSize=8.6, leading=11.8, textColor=INK),
    "th": ParagraphStyle("th", fontName="Sans-Bold", fontSize=8.2, leading=10.5, textColor=colors.white),
    "tip": ParagraphStyle("tip", fontName="Sans", fontSize=8.8, leading=12.5, textColor=INK2),
    "wtitle": ParagraphStyle("wtitle", fontName="Sans-Bold", fontSize=9.5, leading=12, textColor=colors.white),
    "wstep": ParagraphStyle("wstep", fontName="Sans", fontSize=9, leading=12.8, textColor=INK2),
    "group": ParagraphStyle("group", fontName="Sans-Bold", fontSize=9, leading=12, textColor=TEAL),
}


def P(t, s="body"):
    return Paragraph(t, S[s])


def bullets(items):
    return [Paragraph(t, S["bullet"], bulletText="•") for t in items]


def steps(items):
    return [Paragraph(t, S["step"], bulletText=f"{i}.") for i, t in enumerate(items, 1)]


def box(content, bg=TEAL_BG, border=colors.HexColor("#99e6da"), pad=8):
    t = Table([[content]], colWidths=[W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg), ("BOX", (0, 0), (-1, -1), 0.6, border),
        ("LEFTPADDING", (0, 0), (-1, -1), pad), ("RIGHTPADDING", (0, 0), (-1, -1), pad),
        ("TOPPADDING", (0, 0), (-1, -1), pad), ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
    ]))
    return t


def tip(text, label="Tip"):
    return box([P(f"<b>{label}.</b> {text}", "tip")])


def table(rows, widths):
    data = [[P(c, "th") if i == 0 else (P(c, "cellb") if j == 0 else P(c, "cell")) for j, c in enumerate(r)] for i, r in enumerate(rows)]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def shot(name, caption, crop=None, width=W, max_h=150 * mm):
    """A screenshot (optionally cropped, in source pixels), framed, with a caption."""
    src = IMG / f"{name}.jpg"
    if not src.exists():
        print(f"missing screenshot: {name}")
        return Spacer(1, 0)
    im = PILImage.open(src)
    if crop:
        # Never crop past the image (full-page screenshots vary in height).
        crop = (crop[0], crop[1], min(crop[2], im.width), min(crop[3], im.height))
        im = im.crop(crop)
        src = IMG / f"_{name}-{crop[1]}-crop.jpg"
        im.convert("RGB").save(src, quality=85)
    w, h = im.size
    dw = width
    dh = dw * h / w
    if dh > max_h:
        dh = max_h
        dw = dh * w / h
    img = Image(str(src), width=dw, height=dh)
    frame = Table([[img]], colWidths=[dw + 2])
    frame.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    frame.hAlign = "CENTER"
    return KeepTogether([frame, P(caption, "caption")])


def side_by_side(names, caption, crop=None):
    cells = []
    each = (W - 6 * mm) / len(names)
    for n in names:
        src = IMG / f"{n}.jpg"
        im = PILImage.open(src)
        if crop:
            im = im.crop(crop)
            src = IMG / f"_{n}-crop.jpg"
            im.convert("RGB").save(src, quality=85)
        w, h = im.size
        cells.append(Image(str(src), width=each, height=each * h / w))
    t = Table([cells], colWidths=[each + 3 * mm] * len(names))
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOX", (0, 0), (0, 0), 0.6, LINE), ("BOX", (1, 0), (1, 0), 0.6, LINE)]))
    return KeepTogether([t, P(caption, "caption")])


# ── Walkthroughs ─────────────────────────────────────────────────────────────

def num_badge(n):
    d = Drawing(7 * mm, 7 * mm)
    d.add(Circle(3.5 * mm, 3.5 * mm, 3.2 * mm, fillColor=TEAL, strokeColor=TEAL))
    d.add(String(3.5 * mm, 2.25 * mm, str(n), fontName="Sans-Bold", fontSize=8.5, fillColor=colors.white, textAnchor="middle"))
    return d


def framed(name, width, max_h=85 * mm):
    src = IMG / f"{name}.jpg"
    im = PILImage.open(src)
    w, h = im.size
    dw, dh = width, width * h / w
    if dh > max_h:
        dh, dw = max_h, max_h * w / h
    t = Table([[Image(str(src), width=dw, height=dh)]], colWidths=[dw + 1])
    t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                           ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    t.hAlign = "LEFT"
    return t


def walkthrough(title, steps, img_w=92 * mm):
    """Numbered steps. Each step: (text, image or None, "side" | "wide").
    side = text left, screenshot right; wide = screenshot under the text, full width."""
    inner = W - 2
    text_w = inner - 9 * mm - img_w - 3 * mm
    rows = [[P(f"WALKTHROUGH  \u00b7  {title}", "wtitle"), "", ""]]
    style = [("BACKGROUND", (0, 0), (-1, 0), INK), ("SPAN", (0, 0), (-1, 0)),
             ("VALIGN", (0, 1), (-1, -1), "TOP"), ("BOX", (0, 0), (-1, -1), 0.6, LINE),
             ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
             ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
             ("BACKGROUND", (0, 1), (-1, -1), colors.white)]
    for i, (text, img, mode) in enumerate(steps, 1):
        r = len(rows)
        if r > 1:
            style.append(("LINEABOVE", (0, r), (-1, r), 0.4, LINE))
        if img and mode == "side":
            rows.append([num_badge(i), P(text, "wstep"), framed(img, img_w)])
        else:
            cell = [P(text, "wstep")]
            if img:
                cell += [Spacer(1, 4), framed(img, inner - 9 * mm - 14, max_h=68 * mm)]
            rows.append([num_badge(i), cell, ""])
            style.append(("SPAN", (1, r), (2, r)))
    t = Table(rows, colWidths=[9 * mm, text_w, img_w + 3 * mm], repeatRows=1)
    t.setStyle(TableStyle(style))
    return t


def wrap(text, font, size, width):
    out = []
    for para in text.split("\n"):
        line = ""
        for word in para.split(" "):
            test = (line + " " + word).strip()
            if pdfmetrics.stringWidth(test, font, size) <= width:
                line = test
            else:
                out.append(line)
                line = word
        out.append(line)
    return out


def telegram_chat():
    """Illustration of a chat with the bot (drawn, not a screenshot)."""
    w = 74 * mm
    msgs = [
        ("me", "/council Should we send WhatsApp reminders to 1-30 DPD customers instead of SMS?"),
        ("bot", "The council is meeting. This takes 1-3 minutes; I will send the verdict here."),
        ("bot", "VERDICT\nPilot WhatsApp reminders in two branches for 8 weeks, with SMS as fallback, and compare cure rates before rolling out.\n\nWHY\nCheaper per contact and higher read rates, but consent and PDPA wording must be checked first.\n\nFull report, action plan and PDF: https://council.xanderia.com.my/c/..."),
        ("me", "Voice note  0:05"),
        ("bot", "\U0001F399 \u201cBerapa kos untuk perintis di dua cawangan?\u201d".replace("\U0001F399 ", "Heard: ")),
        ("bot", "Anggaran kos perintis: ... (jawapan dalam Bahasa Malaysia)"),
    ]
    font, size, lead = "Sans", 6.6, 8.2
    bw = w - 22 * mm
    blocks = []
    for who, text in msgs:
        lines = wrap(text, font, size, bw - 8)
        tw = max(pdfmetrics.stringWidth(l, font, size) for l in lines) + 8
        blocks.append((who, lines, tw, len(lines) * lead + 7))
    head, pad = 13 * mm, 5
    h = head + sum(b[3] + pad for b in blocks) + 10
    d = Drawing(w, h)
    d.add(Rect(0, 0, w, h, rx=10, ry=10, fillColor=colors.HexColor("#dfe9ef"), strokeColor=INK, strokeWidth=2.2))
    d.add(Rect(1.1, h - head, w - 2.2, head - 1.1, rx=9, ry=9, fillColor=INK, strokeColor=INK))
    d.add(Rect(1.1, h - head, w - 2.2, 6, fillColor=INK, strokeColor=INK))
    d.add(Circle(9 * mm, h - head / 2, 3.2 * mm, fillColor=TEAL, strokeColor=TEAL))
    d.add(String(9 * mm, h - head / 2 - 2.3, "X", fontName="Sans-Bold", fontSize=7.5, fillColor=colors.white, textAnchor="middle"))
    d.add(String(14 * mm, h - head / 2 + 1, "Xanderia Council Bot", fontName="Sans-Bold", fontSize=7.8, fillColor=colors.white))
    d.add(String(14 * mm, h - head / 2 - 7, "bot", fontName="Sans", fontSize=6.2, fillColor=colors.HexColor("#9fb3c2")))
    y = h - head - 6
    for who, lines, tw, bh in blocks:
        y -= bh
        x = w - 5 - tw if who == "me" else 5
        d.add(Rect(x, y, tw, bh, rx=5, ry=5, fillColor=colors.HexColor("#e3fbd4") if who == "me" else colors.white,
                   strokeColor=colors.HexColor("#c9d6df"), strokeWidth=0.4))
        for j, l in enumerate(lines):
            bold = l.isupper() and len(l) < 20
            d.add(String(x + 4, y + bh - 4 - (j + 1) * lead + 2, l, fontName="Sans-Bold" if bold else font, fontSize=size, fillColor=INK))
        y -= pad
    return d


def catalogue(groups):
    """Complete feature list: groups of (feature, what it does, where)."""
    rows = [[P("Feature", "th"), P("What it does", "th"), P("Where", "th")]]
    style = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, 0), INK), ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
             ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
             ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5)]
    for title, items in groups:
        r = len(rows)
        rows.append([P(title.upper(), "group"), "", ""])
        style += [("SPAN", (0, r), (-1, r)), ("BACKGROUND", (0, r), (-1, r), TEAL_BG), ("TOPPADDING", (0, r), (-1, r), 6)]
        for f, what, where in items:
            rows.append([P(f, "cellb"), P(what, "cell"), P(where, "cell")])
    t = Table(rows, colWidths=[40 * mm, 92 * mm, 38 * mm], repeatRows=1)
    t.setStyle(TableStyle(style))
    return t


# ── Diagrams ─────────────────────────────────────────────────────────────────

def arrow(d, x1, y1, x2, y2, color=TEAL):
    d.add(Line(x1, y1, x2 - 4, y2, strokeColor=color, strokeWidth=1.3))
    d.add(Polygon([x2, y2, x2 - 5, y2 + 3, x2 - 5, y2 - 3], fillColor=color, strokeColor=color))


def node(d, x, y, w, h, title, sub="", dark=False, tone=None):
    fill = INK if dark else (tone or BG)
    d.add(Rect(x, y, w, h, rx=6, ry=6, fillColor=fill, strokeColor=INK if dark else LINE))
    d.add(String(x + 6, y + h - 13, title, fontName="Sans-Bold", fontSize=8.6, fillColor=colors.white if dark else INK))
    for i, line in enumerate(sub.split("\n") if sub else []):
        d.add(String(x + 6, y + h - 25 - i * 9, line, fontName="Sans", fontSize=6.8, fillColor=colors.HexColor("#c7d4de") if dark else MUTED))


def journey_diagram():
    d = Drawing(W, 150 * mm / 2.6)
    h = 34
    y1 = 120
    node(d, 0, y1, 78, h, "1. Ask", "type a question,\nplan or decision")
    node(d, 96, y1, 80, h, "2. Intake", "department, intent,\npersonal data check")
    node(d, 194, y1 + 22, 92, h - 6, "Quick answer", "one department expert")
    node(d, 194, y1 - 26, 92, h + 4, "Council", "6 advisors, optional peer\nreview, Chairman decides")
    node(d, 304, y1 - 26, 90, h + 4, "3. Verdict", "decision, risks, action plan,\nanalytics report", dark=True)
    node(d, 412, y1 - 26, 70, h + 4, "4. Act", "Action Crew:\ntasks + emails", tone=TEAL_BG)
    arrow(d, 78, y1 + h / 2, 96, y1 + h / 2)
    arrow(d, 176, y1 + h / 2 + 6, 194, y1 + 36)
    arrow(d, 176, y1 + h / 2 - 6, 194, y1 - 8)
    arrow(d, 286, y1 - 8, 304, y1 - 8)
    arrow(d, 394, y1 - 8, 412, y1 - 8)
    # crew row
    yc = 22
    names = [("Dispatcher", "splits the plan into tasks,\nfinds owners in the directory"), ("You approve", "owners, dates and emails\n(nothing sent before this)"),
             ("Herald", "emails each owner with\none-click status buttons"), ("Tracker", "reminders, nudges and\nescalation (with approval)"), ("Runner", "drafts the tasks the AI\ncan do, for your review")]
    x = 0
    for i, (t, s) in enumerate(names):
        node(d, x, yc, 88, 42, t, s, dark=(t == "You approve"))
        if i < len(names) - 1:
            arrow(d, x + 88, yc + 21, x + 98, yc + 21)
        x += 98
    d.add(Line(447, y1 - 26, 447, yc + 50, strokeColor=TEAL, strokeWidth=1, strokeDashArray=[3, 2]))
    d.add(String(0, yc + 50, "Action Crew (after you press \u201cPut into action\u201d)", fontName="Sans-Bold", fontSize=7.5, fillColor=TEAL))
    return d


def architecture_diagram():
    d = Drawing(W, 70 * mm)
    node(d, 0, 110, 90, 44, "Staff browser / phone", "https://council\n(internal network only)")
    node(d, 115, 110, 90, 44, "Web gateway", "HTTPS (Caddy)")
    node(d, 230, 110, 100, 44, "Council app (API)", "login, roles, chat, reports,\naction plans, audit log")
    node(d, 355, 110, 127, 44, "Database", "conversations, knowledge base,\ntasks, audit log (PostgreSQL)")
    node(d, 230, 30, 100, 50, "Council worker", "runs the advisors, Chairman\nand Action Crew; reminders;\nemail sending")
    node(d, 355, 30, 127, 50, "Qwen 2.5 on the GPU server", "Ollama: qwen2.5:14b and\nnomic-embed-text\n(on-premises)", dark=True)
    node(d, 0, 30, 205, 50, "Email (optional)", "outbox by default: nothing leaves.\nSMTP or n8n when enabled;\ninternal addresses only", tone=AMBER_BG)
    arrow(d, 90, 132, 115, 132)
    arrow(d, 205, 132, 230, 132)
    arrow(d, 330, 132, 355, 132)
    arrow(d, 280, 110, 280, 80)
    arrow(d, 330, 55, 355, 55)
    arrow(d, 230, 55, 205, 55)
    d.add(Rect(222, 20, 268, 142, rx=8, ry=8, fillColor=None, strokeColor=TEAL, strokeDashArray=[4, 3], strokeWidth=0.8))
    d.add(String(226, 8, "Everything in the dashed box runs on Xanderia's own servers.", fontName="Sans-Italic", fontSize=7.2, fillColor=TEAL))
    return d


# Crops for the Part 4 / 5 screenshots (source pixels, 1920 x 1200 captures).
TEMPLATES_CROP = (580, 200, 1780, 960)
DIALOG_CROP = (452, 156, 1468, 1046)
SCRIPT_CROP = (600, 0, 1760, 1090)
WHATIF_FORM_CROP = (600, 330, 1760, 600)
WHATIF_CROP = (600, 0, 1760, 980)
DRAFT_PICKER_CROP = (600, 420, 1760, 960)
DRAFT_CROP = (600, 0, 1760, 960)
DECISIONS_CROP = (60, 80, 1860, 400)
DECISION_DETAIL_CROP = (260, 90, 1660, 1200)
BRIEF_CROP = (80, 190, 1840, 1200)
CALC_CROP = (60, 100, 1860, 640)
ARREARS_CROP = (100, 180, 1820, 1200)
VOICE_CROP = (580, 990, 1780, 1200)
BM_CROP = (60, 80, 1860, 640)
KNOWLEDGE_CROP = (330, 90, 1900, 830)
HEATMAP_CROP = (350, 60, 1890, 500)
DIGEST_CROP = (350, 510, 1890, 1200)
REDFLAG_CROP = (560, 20, 1760, 520)


# ── Page furniture ───────────────────────────────────────────────────────────

def cover(c, doc):
    w, h = A4
    c.setFillColor(INK)
    c.rect(0, h - 120 * mm, w, 120 * mm, fill=1, stroke=0)
    cx, cy = 29 * mm, h - 34 * mm
    c.setStrokeColor(TEAL_LIGHT)
    c.setFillColor(TEAL_LIGHT)
    c.setLineWidth(1.4)
    c.line(cx, cy + 3 * mm, cx, cy - 2 * mm)
    c.line(cx - 5 * mm, cy - 5 * mm, cx - 1 * mm, cy - 2 * mm)
    c.line(cx + 5 * mm, cy - 5 * mm, cx + 1 * mm, cy - 2 * mm)
    for dx, dy in [(0, 5), (-7, -6), (7, -6)]:
        c.circle(cx + dx * mm, cy + dy * mm, 2.4 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Sans-Bold", 32)
    c.drawString(20 * mm, h - 66 * mm, "Xanderia AI Council")
    c.setFont("Sans", 15)
    c.setFillColor(colors.HexColor("#cdf6ee"))
    c.drawString(20 * mm, h - 78 * mm, "Features and how-to guide")
    c.setFont("Sans", 10)
    c.setFillColor(colors.HexColor("#c7d4de"))
    c.drawString(20 * mm, h - 94 * mm, "Ask questions  ·  Pressure-test plans with an AI council  ·  Put decisions into action")
    c.drawString(20 * mm, h - 104 * mm, "Xanderia Services Sdn Bhd  ·  Internal  ·  September 2026  ·  Runs on-premises on Qwen 2.5")
    footer(c, doc)


def footer(c, doc):
    w, _ = A4
    c.setFont("Sans", 7.5)
    c.setFillColor(MUTED)
    c.drawString(20 * mm, 12 * mm, "Xanderia AI Council · Features & how-to guide · Internal")
    c.drawRightString(w - 20 * mm, 12 * mm, f"Page {doc.page}")


# ── Content ──────────────────────────────────────────────────────────────────

def build(out):
    doc = SimpleDocTemplate(str(out), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=20 * mm,
                            title="Xanderia AI Council: Features and How-to Guide", author="Xanderia Services Sdn Bhd",
                            subject="What the Xanderia AI Council does and how to use it")
    st = [Spacer(1, 118 * mm)]

    st += [P("What's inside", "h2"),
           table([["Part", "For", "Covers"],
                  ["1. What it is", "Everyone", "The three things it does, how a question flows, where it runs"],
                  ["2. Features at a glance", "Everyone", "The main features on two pages (the full list is in part 8)"],
                  ["3. Using it", "All staff", "Asking, the council, reading a verdict, the report, sharing, putting a plan into action, tasks you receive"],
                  ["4. Doing more", "All staff", "Templates, script checker, what-if, drafting documents and Word, the decision register, calculators, arrears files, Telegram, voice, Bahasa Malaysia screens, attaching documents, company memory"],
                  ["5. Loan and Collections work", "Collections, Finance, Credit", "Portfolio report, salary-deduction reconciliation, payslip affordability, notis blast, document templates (mail merge)"],
                  ["6. Running it", "Admins, department leads", "Users and invites, staff directory, Action Crew and email, knowledge and freshness, prompts, models, heatmap, weekly digest, red flags, lead setup checklist, company memory, loan-tool settings, go-live checklist"],
                  ["7. Privacy, safety and tips", "Everyone", "What stays on-premises, what needs approval, good questions, timing, FAQ"],
                  ["8. Complete feature list", "Everyone", "Every feature, what it does and where to find it, on a few pages"]],
                 [42, 38, 90]),
           Spacer(1, 6),
           tip("In the app, press the <b>?</b> button (top of each page, or next to EN / BM in the sidebar) to open the part of this guide for that page. Everything the Council says is <b>advice</b>. Final decisions sit with the responsible staff and management. Legal and finance answers must be reviewed before acting.", "Remember"),
           PageBreak()]

    # Part 1
    st += [P("1 · What it is", "h1"),
           P("Xanderia AI Council is our internal advisory assistant. Any employee, in any department, can use it to:", "lead"),
           table([["", "What you get", "Typical use"],
                  ["Ask", "A fast, direct answer from an advisor for the department you choose, grounded in that department's documents when they are loaded.", "\u201cWhat must a staff data-access policy cover under PDPA?\u201d"],
                  ["Council", "Six AI advisors with different mandates look at your plan or decision independently. A Chairman weighs them and returns one verdict with an action plan, risks, open questions and a confidence level.", "\u201cShould we offer 60-90 DPD customers a 3-month restructuring?\u201d"],
                  ["Act", "The Action Crew turns the verdict into tasks, finds the right people, emails them after you approve, and follows up until the work is done.", "Put the restructuring pilot into motion with owners and dates."]],
                 [22, 88, 60]),
           P("How a question flows", "h2"), journey_diagram(),
           P("You can leave the page while the council works. You'll get a notification when the verdict is ready.", "small"),
           P("Where it runs", "h2"), architecture_diagram(),
           P("The AI model (Qwen 2.5, 14B) runs on Xanderia's own GPU server. Questions, documents and verdicts are not sent to any outside AI service. Every model call is written to an audit log.", "body"),
           PageBreak()]

    # Part 2
    st += [P("2 · Features at a glance", "h1"),
           table([["Feature", "What it does"],
                  ["Auto / Quick / Council", "Auto lets the system pick. Quick gives one fast answer. Council convenes the six advisors."],
                  ["Department selector", "Ask as your own department or \u201cask another department\u201d. Its expert answers, but you still only see documents you have access to."],
                  ["Clarifying questions", "Before a council run, it may ask up to 3 short questions if key facts are missing. Answer them, or skip and let it proceed on stated assumptions."],
                  ["Live progress", "See Intake \u2192 Advisors \u2192 (Peer review) \u2192 Chairman as it happens. Advisors' opinions stream in as they write."],
                  ["The verdict", "Decision, why, disagreements resolved, action plan (owner, timeline), risks rated by likelihood and impact, open questions, confidence."],
                  ["Advisor stances", "Each advisor declares For / Conditional / Against with a conviction score. A summary bar shows how the council split."],
                  ["Peer review (optional)", "Advisors critique each other anonymously and score each answer 1\u20135. Adds about half a minute."],
                  ["Analytics report (PDF)", "Executive summary, stance map, peer scores, risk heat map, action-plan timeline, disagreements, and every advisor's full opinion."],
                  ["Follow-ups", "Ask a follow-up in the same conversation, or click an open question to answer it and have the council reconsider."],
                  ["Share", "Copy a read-only link for a colleague (they must be signed in). You can revoke it."],
                  ["Knowledge base", "Department and company-wide libraries (PDF, Word, Excel, text). Answers cite the document and page, section or sheet."],
                  ["Put into action", "The Action Crew: Dispatcher, Herald, Tracker and Runner (see 3.7\u20133.9)."],
                  ["Tasks and notifications", "Your assigned tasks, the plans you started, and a bell for updates, nudges and approvals."],
                  ["History", "Search, pin, rename and delete conversations. You can delete your whole history at any time."],
                  ["Council templates <font color='#0d9488'>new</font>", "Guided starters (new product, collections change, vendor selection, hiring plan, policy draft) that ask for the facts the council needs."],
                  ["Customer script checker <font color='#0d9488'>new</font>", "Paste an SMS, letter or call script: tone, clarity, fair treatment and PDPA check, with a rewrite in English and BM."],
                  ["What-if <font color='#0d9488'>new</font>", "Change one assumption under a verdict. Two advisors re-run and the Chairman updates the verdict, in about half the time."],
                  ["Draft a document, Word <font color='#0d9488'>new</font>", "Turn an answer into an SOP, policy, customer letter or staff memo. Download any answer as an editable Word file."],
                  ["Decision register <font color='#0d9488'>new</font>", "Record verdicts as decisions. At 30 and 60 days you're asked whether it worked. One-page meeting brief for any period."],
                  ["Calculators <font color='#0d9488'>new</font>", "Instalment and EIR, early settlement rebate, roll rates, cost to collect, each with “Ask the council about this”."],
                  ["Arrears file analysis <font color='#0d9488'>new</font>", "Upload a collections export: DPD buckets by branch and product, then ask the council. The file isn't stored."],
                  ["Telegram and voice <font color='#0d9488'>new</font>", "Ask from Telegram, or speak your question in BM or English. Speech is transcribed on our own server."],
                  ["Bahasa Malaysia", "Ask in BM and the answer comes back in BM. The whole app can also be switched to BM (EN / BM toggle)."],
                  ["Compliance seat, red flags <font color='#0d9488'>new</font>", "A Compliance Officer joins the council for sensitive departments. Requests that look like harassment, fraud, data misuse or discrimination are flagged to Compliance."],
                  ["Attach documents <font color='#0d9488'>new</font>", "Attach a PDF, Word, Excel or text file to a question and the council judges the plan in it."],
                  ["Company memory <font color='#0d9488'>new</font>", "Lessons from recorded outcomes, answers approved by leads, and department house rules are recalled for similar questions."],
                  ["Portfolio report <font color='#0d9488'>new</font>", "Month-end loan export \u2192 NPL, PAR, buckets, branch/product/employer, vintage, roll rates; monthly trend, council commentary, PDF."],
                  ["Deduction reconciliation <font color='#0d9488'>new</font>", "Loans vs the employer or Angkasa deduction file: not deducted, short, over, unknown, with a CSV."],
                  ["Payslip affordability <font color='#0d9488'>new</font>", "The payslip extractor report \u2192 affordable / borderline / not affordable against the deduction limit, with the largest instalment allowed."],
                  ["Notis blast <font color='#0d9488'>new</font>", "The monthly missed-deduction letters from the masterlist: every row checked, letters and Outlook drafts for the batch."],
                  ["Document templates <font color='#0d9488'>new</font>", "Word templates with {{tags}} mapped to spreadsheet columns: one document (and email draft) per row."],
                  ["In-app guide <font color='#0d9488'>new</font>", "The ? button opens this guide at the part for the page you are on."],
                  ["Admin", "Users, invites, departments, prompts with versions and a test sandbox, model settings, knowledge base with review dates, staff directory, Action Crew, email outbox, audit log, heatmap, weekly digest."]],
                 [44, 126]),
           CondPageBreak(150 * mm)]

    # Part 3
    st += [P("3 · Using it", "h1"),
           P("3.1 Sign in and find your way", "h2"),
           P("Open the Council address from your browser or phone and sign in with your work email. Your administrator creates your account."),
           side_by_side(["01-login", "02-home"], "Left: sign in. Right: the home screen, with example questions, your history on the left, and the question box at the bottom.", crop=None),
           *bullets(["<b>Left sidebar:</b> New question, search, your recent and pinned conversations, then the bell, <b>Tasks</b>, and (for leads and admins) <b>Admin</b>.",
                     "<b>Question box:</b> choose <b>Auto / Quick / Council</b>, the department, and optionally <b>Peer review</b>. Press Enter to send and Shift+Enter for a new line."]),
           P("3.2 Ask a quick question", "h2"),
           *steps(["Choose <b>Quick</b>, or leave it on <b>Auto</b>.", "Pick the department whose expert should answer. It defaults to yours.",
                   "Type the question and press Enter. The answer appears as it is written, usually within a few seconds.",
                   "If documents were used, the sources are listed under the answer as <b>[S1]</b>, <b>[S2]</b> with the document and page."]),
           shot("03-quick", "A Quick answer. The green \u201cProcessed on-premises\u201d badge confirms nothing left Xanderia's servers."),
           tip("If your question depends on something you didn't say (which product? which branch?), the advisor may ask you briefly, or state the assumption it made. Adding those details up front gives better answers."),
           CondPageBreak(90 * mm),
           P("3.3 Bring a plan or decision to the council", "h2"),
           *steps(["Choose <b>Council</b> (or Auto: plans and decisions go to the council automatically).",
                   "Describe the situation: the goal, the numbers you know (volumes, amounts, budget, staff), the constraints and the deadline.",
                   "Tick <b>Peer review</b> if you want the advisors to critique each other first (slower, sharper).",
                   "If key facts are missing, the council asks up to 3 questions first. Answer them in one message, or press <b>Skip</b> to proceed on its stated assumptions."]),
           shot("04-clarify", "Before the council meets: clarifying questions, and what it will assume if you skip."),
           shot("05-progress", "While the council works: the progress strip, each advisor's stance as it finishes, and opinions streaming in. You can leave; you'll be notified.", crop=(0, 0, 1920, 830)),
           P("A full council takes about 20\u201340 seconds, or about a minute with peer review. Quick questions from colleagues are always served first.", "small"),
           CondPageBreak(90 * mm),
           P("3.4 Read the verdict", "h2"),
           shot("06-verdict", "The Chairman's verdict sits on top: the decision, confidence, the reasoning, and every disagreement between advisors with how it was settled and why."),
           shot("07-verdict-lower", "Further down: rated risks with mitigations, clickable open questions, what would change the recommendation, then the advisors' opinions and the actions.", crop=(0, 0, 1920, 1000)),
           *bullets(["<b>Disagreements resolved</b> shows which side the Chairman took and the specific reason. It must not decide by head-count.",
                     "<b>Risks</b> carry a likelihood and impact badge (L \u00b7 I). Red means both are significant.",
                     "<b>Open questions:</b> click one, type your answer, and the council reconsiders with it.",
                     "<b>Advisor opinions:</b> expand them to read each advisor in full, with their stance and conviction."]),
           shot("08-opinions", "Each advisor's own opinion, with a For / Conditional / Against badge and a summary of how the council split."),
           CondPageBreak(90 * mm),
           P("3.5 Download the analytics report", "h2"),
           P("Press <b>Download report (PDF)</b> under a verdict. The report is ready to forward or print: an executive summary, the analytics, the risk heat map, the timeline and the full appendix."),
           side_by_side(["21-report-1", "21-report-2"], "Report pages: executive summary (left); where the advisors stand, peer scores and the risk heat map (right)."),
           P("3.6 Share, follow up and give feedback", "h2"),
           *bullets(["<b>Share</b> copies a read-only link. The colleague must be signed in, and every view is logged. You can revoke a link by sharing again and revoking.",
                     "<b>Ask a follow-up</b> continues the same conversation; the council remembers the verdict.",
                     "<b>Copy</b> puts the verdict text on your clipboard.",
                     "<b>Thumbs up or down</b> (with an optional comment) helps the team improve the prompts."]),
           CondPageBreak(100 * mm),
           P("3.7 Put a verdict into action", "h2"),
           P("Press <b>Put into action</b> under a council verdict. In about a minute the Action Crew prepares a plan for you to check. <b>Nothing is sent until you approve.</b>"),
           *steps(["The <b>Dispatcher</b> splits the action plan into tasks with due dates (working days) and the order they depend on.",
                   "Owners are matched to people in the <b>staff directory</b> by position. If several people match, you choose; if no one matches, the task is marked <b>Unassigned</b>. The AI never invents names or email addresses.",
                   "Switch a task to <b>AI Runner drafts it</b> if it is writing work (an SOP, template, checklist or summary). The Runner writes a draft for your review.",
                   "Open <b>Preview / edit email</b> to read and change what the <b>Herald</b> will send.",
                   "Tick <b>Approve</b> per task and press <b>Send approved</b>, or press <b>Approve &amp; send all</b>. Emails go out during business hours (Mon\u2013Fri 9:00\u201318:00) to internal addresses only."]),
           shot("09-launch", "The Launch plan screen: crew status, tasks with suggested owners, due dates, the email preview and per-task approval.", crop=(0, 0, 1920, 1250)),
           CondPageBreak(90 * mm),
           P("3.8 Track progress", "h2"),
           shot("10-board", "The task board: Sent \u2192 Accepted \u2192 In progress \u2192 Blocked \u2192 Done. Owner replies (\u201cNeed the product sheet first\u201d) appear on the card.", crop=(0, 0, 1920, 1300)),
           *bullets(["The <b>Tracker</b> reminds owners who haven't acknowledged (after 1 working day) and reminds them the day before the due date.",
                     "If a task is overdue, you get a nudge: <b>Send reminder</b>, <b>Snooze 2 days</b> or <b>Reassign</b>.",
                     "After 3 working days overdue it proposes an <b>escalation to the owner's manager</b>. It is only sent if you press <b>Escalate</b>.",
                     "Runner drafts appear as <b>draft ready</b>: <b>Review draft</b>, then <b>Approve draft</b> or copy it.",
                     "Your plan's progress bar also shows under the original verdict."]),
           shot("12-notifications", "The bell collects plan-ready alerts, accept/done updates, \u201cneeds help\u201d notes, overdue nudges and escalation requests.", crop=(0, 560, 960, 1200), width=110 * mm),
           CondPageBreak(90 * mm),
           P("3.9 If you receive a task", "h2"),
           P("You'll get an email from the Council on behalf of the colleague who asked. Use its buttons. No login is needed; each button opens a short confirmation page."),
           side_by_side(["13-email", "14-link"], "Left: the task email with Accept / Need help / Mark done / Can't do it. Right: the confirmation page (\u201cNeed help\u201d and \u201cCan't do it\u201d ask for a short note)."),
           P("You can also open <b>Tasks</b> in the app to see everything assigned to you and update it there."),
           shot("11-tasks", "Tasks: work assigned to you (with Accept, Start, Mark done, Need help and Can't do) and the action plans you started.", crop=(0, 0, 1920, 1100)),
           PageBreak()]

    # Part 4
    st += [P("4 · Doing more with the council", "h1"),
           P("Step-by-step walkthroughs. In each screenshot, the <font color='#d97706'><b>amber frame</b></font> marks what to click.", "lead"),

           P("4.1 Start from a template", "h2"),
           P("Templates ask for the facts the council needs up front (goal, numbers, constraints, deadline), so it goes straight to work without clarifying questions. Templates: <b>New product launch</b>, <b>Collections strategy change</b>, <b>Vendor selection</b>, <b>Hiring plan</b> (council); <b>Draft a policy or SOP</b> (quick); <b>Check a customer script</b>."),
           walkthrough("Ask the council with a template", [
               ("Press <b>Templates</b> in the question box, or pick a template card on the home screen.", "w-t1-templates-button", "wide"),
               ("Fill in what you know. Fields marked * are required; empty fields are left out. Press <b>Ask the council</b>.", "23-template-dialog", "side"),
               ("The council starts straight away. The verdict arrives in under a minute, like any council question.", None, None),
           ]),
           Spacer(1, 8),

           P("4.2 Check a customer script before it goes out", "h2"),
           walkthrough("Check a collections SMS", [
               ("Press <b>Templates</b> \u2192 <b>Check a customer script</b>. Choose the channel (SMS, WhatsApp, letter, call), describe the customer's situation, and paste the script.", None, None),
               ("The Customer Advocate checks tone, clarity, fair treatment (no threats, shaming or misleading statements), lawful debt collection (no third-party contact about the debt) and PDPA.", None, None),
               ("You get <b>OK to send</b>, <b>Needs changes</b> or <b>Do not send</b>, a table of issues with fixes, and a rewrite in English and Bahasa Malaysia.", "24-script-check", "wide"),
           ]),
           CondPageBreak(90 * mm),

           P("4.3 Ask \u201cwhat if\u2026\u201d", "h2"),
           P("Test a verdict against a different assumption without running the whole council again. The <b>Contrarian</b> and the <b>Executor</b> re-run; the other advisors' opinions carry over; the Chairman updates the verdict and says what changed. It takes about half the time of a full council."),
           walkthrough("Change one assumption", [
               ("Under a council verdict, press <b>What if\u2026</b>.", "w-w1-whatif-button", "wide"),
               ("Type the changed assumption, for example \u201conly 40% of eligible customers accept\u201d or \u201cthe budget is halved\u201d, and press <b>Re-run</b>.", "27-whatif-form", "wide"),
               ("The updated verdict appears as a new answer in the same conversation, so you can compare it with the original.", "26-whatif", "wide"),
           ]),
           CondPageBreak(90 * mm),

           P("4.4 Draft a document and download Word", "h2"),
           walkthrough("Turn a verdict into a staff memo", [
               ("Under any answer, press <b>Draft a document</b>.", "w-d1-draft-button", "wide"),
               ("Pick the type: <b>SOP</b>, <b>Policy</b>, <b>Customer letter</b> or <b>Staff memo</b>.", "w-d2-draft-kinds", "wide"),
               ("The draft is written from the answer. Anything you must fill in or confirm is marked <b>[TO CONFIRM]</b>.", "29-draft-memo", "wide"),
               ("Press <b>Word</b> to download an editable .docx with headings, lists and tables. <b>Word</b> works under every answer, not only drafts.", "w-d3-word-button", "wide"),
           ]),
           CondPageBreak(90 * mm),

           P("4.5 Record decisions and learn what works", "h2"),
           P("The <b>decision register</b> (sidebar \u2192 <b>Decisions</b>) is the company's memory of what was decided, by whom, and whether it worked."),
           walkthrough("From verdict to outcome", [
               ("When you act on a verdict, press <b>Record as decision</b> under it. It then shows <b>In decision register</b>.", "w-r1-record-button", "wide"),
               ("Open <b>Decisions</b> in the sidebar to search and filter the register by department and status. Each decision shows its action-plan progress and latest outcome. On the decision page you choose who can see it: your department or the whole company.", "30-decisions", "wide"),
               ("<b>30 and 60 days later</b>, you get a notification and an email: <i>did it work?</i>", "w-r2-checkin-bell", "side"),
               ("On the decision page, choose <b>Worked</b>, <b>Partly worked</b>, <b>Did not work</b> or <b>Too early to tell</b>, add what happened (numbers help), and press <b>Record outcome</b>.", "w-r3-outcome", "wide"),
               ("<b>Meeting brief:</b> on the register, press <b>Meeting brief</b>, choose the dates and press <b>Write brief</b>. You get a one-page summary of the decisions, their progress and outcomes, and questions for discussion.", "32-meeting-brief", "wide"),
           ]),
           CondPageBreak(90 * mm),

           P("4.6 Calculators", "h2"),
           P("Sidebar \u2192 <b>Tools</b>. Calculations run in your browser; nothing is sent until you ask the council."),
           table([["Calculator", "What it gives you"],
                  ["Instalment", "Monthly instalment, total interest and total payable, flat rate or reducing balance, and the effective interest rate (EIR) of a flat-rate loan."],
                  ["Early settlement rebate", "The rebate of unearned interest under Rule of 78 and straight-line, the settlement amount, and the difference to the customer. Check which method the agreement requires."],
                  ["Roll rates", "Bucket balances at two month-ends \u2192 the share that rolled one bucket worse (Current \u2192 1\u201330 \u2192 \u2026 \u2192 91+). Rolls above 30% are shown in red."],
                  ["Cost to collect", "Cost per RM 1 collected, cost as a % of collections, and cost per account resolved."]],
                 [38, 132]),
           Spacer(1, 6),
           walkthrough("Take a calculation to the council", [
               ("Open <b>Tools</b> from the sidebar.", "w-c1-tools-link", "side"),
               ("Choose a calculator and enter the figures. The results update as you type. Press <b>Ask the council about this</b>.", "w-c2-calc-ask", "wide"),
               ("The figures are put into a new question. Finish it with what you want to know, choose the mode, and send.", "w-c3-calc-prefilled", "wide"),
           ]),
           CondPageBreak(90 * mm),

           P("4.7 Analyse an arrears file", "h2"),
           walkthrough("From collections export to council question", [
               ("<b>Tools \u2192 Arrears file.</b> Click the box and choose a .csv or .xlsx export, one row per account, with a days-past-due column. Balance, branch and product columns are used if present; English and BM names are recognised (\u201cDPD\u201d, \u201cHari tertunggak\u201d, \u201cBaki\u201d, \u201cCawangan\u201d, \u201cProduk\u201d).", "w-a1-upload", "wide"),
               ("You see the balance in each DPD bucket, and every branch and product with its bucket mix and 91+ share (red above 10%). The file is analysed in memory and <b>not stored</b>.", "35-arrears", "wide"),
               ("Press <b>Ask the council about this file</b>. Only the totals go into the question, never customer rows. Add your question and send.", "w-a2-arrears-prefilled", "wide"),
           ]),
           CondPageBreak(90 * mm),

           P("4.8 Ask from Telegram", "h2"),
           P("If IT has switched the bot on, you can ask the council from Telegram on your phone. Questions go through the same checks as the web app (personal-data guard, audit log, your document access) and appear in your Council history marked <b>[Telegram]</b>."),
           walkthrough("Connect Telegram (once)", [
               ("In the sidebar, click <b>Telegram</b>.", "w-g1-telegram-link", "side"),
               ("Read the warning, then press <b>Connect Telegram</b>.", "w-g2-telegram-connect", "side"),
               ("Press <b>Open @XanderiaCouncilBot and press Start</b> (on your phone, or scan it across). In Telegram, press <b>Start</b>. The link works once and expires in 15 minutes. The bot replies \u201cConnected\u201d.", "w-g3-telegram-open", "side"),
           ], img_w=70 * mm),
           Spacer(1, 8),
           KeepTogether([P("Using the bot", "h3"),
                         Table([[telegram_chat(),
                                 [table([["You send", "What happens"],
                                         ["A question", "Auto: a quick answer, or the full council for plans and decisions. The answer comes back in the chat, with a link to the full report."],
                                         ["/quick \u2026", "A fast answer from one department advisor."],
                                         ["/council \u2026", "The full council. The bot says it has started, then sends the verdict and a link to the report, action plan and PDF."],
                                         ["A voice note", "Transcribed on our own server; the bot shows what it heard, then answers."],
                                         ["A follow-up", "Within 6 hours it continues the same conversation, including answering clarifying questions."],
                                         ["/new", "Start a fresh conversation."],
                                         ["/help, /unlink", "Show help, or disconnect this chat."]],
                                        [24, 68]),
                                  Spacer(1, 4),
                                  P("Illustration of a chat with the bot.", "caption")]]],
                               colWidths=[78 * mm, 92 * mm],
                               style=[("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)])]),
           Spacer(1, 4),
           tip("Telegram is an outside service; messages pass through Telegram's servers. <b>Never send customer personal data</b> (IC, account or phone numbers) through the bot. Use the web app for anything sensitive. Only private chats are answered; group chats are ignored.", "Important"),
           CondPageBreak(80 * mm),

           P("4.9 Ask by voice", "h2"),
           walkthrough("Speak your question", [
               ("Press the <b>microphone</b> next to Send. The first time, allow microphone access in your browser.", "w-v1-mic", "wide"),
               ("Speak in English or Bahasa Malaysia. The button turns red while recording (up to 2 minutes). Press it again to stop.", "w-v2-recording", "wide"),
               ("The words appear in the box after a few seconds. Check them, edit if needed, and press Send. Transcription runs on Xanderia's own server; the recording is not stored.", "w-v3-transcript", "wide"),
           ]),
           Spacer(1, 8),

           P("4.10 Bahasa Malaysia screens", "h2"),
           P("Switch the whole app between English and BM with the <b>EN / BM</b> toggle (on the sign-in page, in the sidebar and at the top of each page). Your choice is saved to your account and follows you to other devices. Answers follow the language of your question, whichever screen language you use."),
           shot("40-bm-tools", "The Tools page in Bahasa Malaysia.", crop=BM_CROP),
           CondPageBreak(90 * mm),

           P("4.11 Attach a document for the council to judge", "h2"),
           walkthrough("Judge a plan in a document", [
               ("Press the <b>paperclip</b> in the question box and choose the file: PDF with a text layer (not a scan), Word, Excel, CSV or text. Up to 5 files.", None, None),
               ("Add your question, for example \u201cJudge this plan. Is the budget realistic?\u201d, and choose <b>Council</b> for a plan or proposal. Send without text and the council reviews the document.", "43-attach", "wide"),
               ("Only the text of the file is kept with the conversation, under the same retention as your history.", None, None),
           ]),
           CondPageBreak(80 * mm),

           P("4.12 Company memory", "h2"),
           P("The council gets more accurate as more people use it. Three kinds of company memory are recalled for each question, and the answer says when it drew on them (\u201cDrew on company memory: 2 house rules, 1 past decision\u201d)."),
           table([["Memory", "Where it comes from"],
                  ["Lessons", "Outcomes recorded in the decision register (worked, partly, did not work) are recalled when someone asks something similar."],
                  ["Approved answers", "Under a good answer, press <b>Suggest as company answer</b>. The department lead approves it (editing first if needed) and the council reuses it for similar questions in that department, or company-wide."],
                  ["House rules", "Short facts the council must always follow for a department, e.g. \u201cOur NPL definition is 90 days past due; restructured loans are included.\u201d Set by leads in Admin \u2192 Company memory."]],
                 [34, 136]),
           PageBreak()]

    # Part 5 (loan and Collections work)
    st += [P("5 \u00b7 Loan and Collections work", "h1"),
           P("Tools for Collections, Finance and Credit. Customer files are read in memory and not stored unless stated; only totals go to the council.", "lead"),
           P("5.1 Monthly portfolio report", "h2"),
           walkthrough("From month-end export to management report", [
               ("<b>Tools \u2192 Portfolio report.</b> Choose the month and upload the month-end loan export (.csv or .xlsx, one row per account, with a DPD column). Balance, branch, product, employer, disbursement date and a restructured flag are used when present. Add last month\u2019s export for roll rates.", None, None),
               ("Press <b>Analyse</b>: NPL ratio (by balance and by accounts), PAR30/60/90, DPD buckets, breakdowns by branch, product and employer, vintage by disbursement quarter and the roll-rate matrix, all calculated exactly.", "46-portfolio", "wide"),
               ("Leads and admins tick <b>Save as this month\u2019s report</b> (totals only) to build the trend. Then <b>Write council commentary</b> (a CRO-style draft: read it before sending), <b>Download PDF report</b>, or <b>Email to Management</b> (recipients in Admin \u2192 Settings).", None, None),
           ]),
           tip("On the 1st of each month, admins and the Finance, Collections and Management leads get a reminder to upload the export. The NPL definition (days past due, restructured loans) is set in Admin \u2192 Settings."),
           CondPageBreak(90 * mm),

           P("5.2 Salary-deduction reconciliation", "h2"),
           walkthrough("Find missed and short deductions", [
               ("<b>Tools \u2192 Deduction reconciliation.</b> Upload the loans with their monthly instalment, and the deduction file from the employer or Angkasa.", None, None),
               ("They are matched on account number, IC number or salary number, whichever both files have (IC formatting doesn\u2019t matter). Press <b>Reconcile</b>.", None, None),
               ("You get every loan <b>not deducted</b>, <b>short</b> or <b>over</b>, and deductions with <b>no matching loan</b>, with amounts and the total shortfall. <b>Download exceptions</b> gives an Excel CSV.", "47-deductions", "wide"),
           ]),
           CondPageBreak(90 * mm),

           P("5.3 Payslip affordability check", "h2"),
           walkthrough("Check an application against the deduction limit", [
               ("<b>Tools \u2192 Payslip affordability.</b> Upload the \u201cPayslip Extraction Result\u201d report from the payslip extractor (one or more months) and enter the instalment, or the amount, rate and tenure.", None, None),
               ("The new instalment is added to existing deductions for the <b>weakest month</b> and checked against the limit (60% of gross by default; set in Admin \u2192 Settings): <b>Affordable</b>, <b>Borderline</b> or <b>Not affordable</b>, with the largest instalment the rule allows.", "48-affordability", "wide"),
               ("Flags point out existing financing, lines the extractor marked Not Match, big month-to-month changes and fewer than 3 payslips. <b>Draft a credit memo</b> starts the memo from these figures. Name and IC are never sent to the council.", None, None),
           ]),
           CondPageBreak(90 * mm),

           P("5.4 Notis blast (missed salary deduction letters)", "h2"),
           P("Sidebar \u2192 <b>Notis blast</b> (Collections staff and admins). It produces the monthly <i>Makluman Tunggakan Bayaran Ansuran Bulanan</i> letter for every customer in the masterlist, with the approved wording, logo and bank details."),
           walkthrough("Run the monthly batch", [
               ("Download the masterlist from SharePoint and upload it as it is; the \u201cMISS DEDUCTION EMAIL\u201d sheet is read. Choose the date to print on the letters and press <b>Check the list</b>.", None, None),
               ("Every row is checked. <b>Held by Finance</b>: something is written in \u201cremarks Ain\u201d. <b>No valid email</b> and <b>Incomplete data</b> are skipped. <b>Check first</b> flags amounts that don\u2019t equal instalment \u00d7 months, unreadable months, blank AS OF DATE (the list\u2019s usual date is used), IC numbers that aren\u2019t 12 digits and shared emails. Preview any letter, fix an email, or untick a customer.", "49-notis", "wide"),
               ("Press <b>Download Outlook drafts</b>. Extract the zip and double-click each file: classic Outlook opens it addressed, with the letter attached. Check it and press Send. The zip includes <b>_Not sent - follow up.csv</b>.", None, None),
           ]),
           tip("Every download is recorded in the send log. Customer details are removed from batches after 90 days (the log is kept). Direct sending from the Council switches on once IT connects the Collections mailbox; it needs a lead, a test copy first and typing SEND."),
           CondPageBreak(90 * mm),

           P("5.5 Document templates (mail merge)", "h2"),
           P("Sidebar \u2192 <b>Doc templates</b>. A Word document with <b>{{tags}}</b> becomes one document per spreadsheet row. Each tag is matched to a column once; values are filled straight from the spreadsheet, not written by the AI, so a batch takes seconds and every amount is exactly what is in the file."),
           walkthrough("Make reminder letters from a spreadsheet", [
               ("In Word, type tags where the data goes (<b>{{customername}}</b>, <b>{{amount}}</b>, <b>{{date}}</b>) and save as .docx, then upload it. Or, on the <b>Template</b> tab, select sample text in the preview, name the tag and press <b>Make tag</b> (the formatting is kept).", "52-templates-tag", "wide"),
               ("On <b>Data &amp; mapping</b>, upload the spreadsheet. Tags are matched to columns by name; <b>Suggest the rest with AI</b> uses column names only. Choose a format per tag (RM, dates, IC, Malay months, capitals), add conditions (e.g. \u201cremarks Ain is blank\u201d) and a file-name pattern, then <b>Save changes</b>.", "50-templates-mapping", "wide"),
               ("On <b>Email</b>, choose the email column and write the subject and message with the same tags.", "53-templates-email", "wide"),
               ("On <b>Generate</b>, check the rows (blank tags and bad emails are flagged) and download the <b>Word documents</b> or <b>Outlook drafts</b>. Next month, upload the new spreadsheet: the mapping is kept.", "51-templates-generate", "wide"),
           ]),
           tip("Templates belong to your department; tick Company-wide to share one. PDF output needs a converter on the server; until then documents are Word files."),
           PageBreak()]

    # Part 5
    st += [P("6 · Running it (admins and department leads)", "h1"),
           P("Department leads see <b>Knowledge</b> for their own department. Admins see everything below under <b>Admin</b>.", "lead"),
           P("6.1 Users and invites", "h2"),
           P("<b>Admin → Users → Add user.</b> Leave the password empty and the new colleague gets an email (English and BM) with a link to set their own password, valid for 7 days. <b>Resend invite</b> issues a new link. Anyone can use <b>Forgot password?</b> on the sign-in page for a 1-hour reset link. Until email is connected, the invite link is shown on screen for you to pass on."),
           side_by_side(["41-invite-admin", "42-invite-set"], "Left: a new user with an invite link. Right: the page where they set their password."),
           P("6.2 Staff directory", "h2"),
           P("The Action Crew only assigns tasks and sends emails to people in this directory. Import the HR export as CSV with the columns <b>name, position, department, email, manager_email</b>. Re-importing updates people by email. Add or edit people one by one as needed."),
           shot("15-directory", "Admin \u2192 Staff directory. (The people shown are test entries.)"),
           P("6.3 Action Crew and email", "h2"),
           *bullets(["<b>Allowed email domains:</b> emails to any other domain are blocked.",
                     "<b>Business hours and weekend:</b> Kedah, Kelantan and Terengganu can use a Friday\u2013Saturday weekend.",
                     "<b>Reminder and escalation timings.</b> Escalation can be switched off.",
                     "<b>Public holidays:</b> add national and state holidays each year; no emails are sent and no working days are counted on them.",
                     "<b>Email outbox:</b> every email the Crew produced, with its status. By default emails are <b>only recorded, not sent</b>, until IT connects SMTP or n8n."]),
           shot("16-crew-admin", "Admin \u2192 Action Crew & email."),
           P("6.4 Knowledge base and review dates", "h2"),
           P("Upload SOPs, policies, product sheets and FAQs (PDF, Word, Excel, text). Choose who can retrieve each document: one department or company-wide. Staff only get answers from their own department's documents and company-wide ones, unless an admin grants extra access. Scanned PDFs without a text layer are rejected."),
           P("Every document has a <b>review interval</b> (30, 90, 180 or 365 days; 180 by default). When it passes, the document shows <b>Review due</b>, and the uploader and the department lead (or admins, for company-wide documents) get a notification. Check the document, then press <b>Mark reviewed</b>, upload a new version, or delete it. The council keeps quoting a stale document until you do."),
           shot("38-knowledge-fresh", "Admin \u2192 Knowledge: upload, review dates, and a document due for review.", crop=KNOWLEDGE_CROP),
           P("6.5 Personas, prompts and the test sandbox", "h2"),
           P("Each advisor's behaviour comes from short prompt layers (base \u2192 persona \u2192 department \u2192 task). Edit a layer and save it as a new version; any older version can be re-activated. Before saving, use <b>Test this prompt</b> to run your draft with a sample question and see the output and whether it still produces a valid verdict."),
           shot("18-prompts", "Admin \u2192 Personas & prompts, with version history and the test sandbox.", crop=(0, 0, 1920, 1300)),
           P("6.6 Models, audit and settings", "h2"),
           *bullets(["<b>Model routing:</b> the model and settings per role (Qwen 2.5 14B by default). Upgrading the model is a setting, not a redeploy.",
                     "<b>Audit log:</b> every login, question (by reference, not text), model call, document retrieval, email and status change. It cannot be edited.",
                     "<b>Settings:</b> who can use Council mode, retention (default 12 months), peer review default, clarifying questions on or off, knowledge base on or off, the weekly digest on or off, which departments get the Compliance seat, and the loan tools (6.10)."]),
           side_by_side(["19-models", "20-audit"], "Left: model routing per role. Right: the audit log."),
           CondPageBreak(90 * mm),
           P("6.7 Ask-the-org heatmap and the weekly digest", "h2"),
           P("<b>Admin \u2192 Overview</b> shows which departments ask about which areas over the last 30 to 365 days. A heavy cell outside a department's own area (for example HR asking Finance questions) can point to a training need or an unclear policy. A red ring marks cells with red flags. Only counts are shown, never what anyone asked."),
           shot("37-digest", "The ask-the-org heatmap and questions per week.", crop=HEATMAP_CROP),
           P("Every Monday at 08:00, each <b>department lead</b> gets a digest email for their department: questions asked (and the trend), the areas asked about, decisions and outcomes recorded, overdue action tasks with owners, and documents due for review. Like the heatmap, it holds counts only, never question text. <b>Preview</b> shows what a department will receive; <b>Send now</b> sends this week's digests immediately. A lead can be taken off the list in Admin \u2192 Users."),
           shot("37-digest", "Digest preview for one department.", crop=DIGEST_CROP),
           P("6.8 Compliance seat and red flags", "h2"),
           *bullets(["<b>Compliance seat:</b> for the departments set in Admin \u2192 Settings (default Credit &amp; Collections, Legal &amp; Compliance, Finance and HR), a <b>Compliance Officer</b> joins the council. It checks the plan against the law, BNM guidance and internal policy, using the knowledge base.",
                     "<b>Red flags:</b> if a request looks like harassment, fraud, misuse of personal data or discrimination, the answer still comes, but with a warning, and admins and Legal &amp; Compliance leads get a notification. The flag is written to the audit log. Blocking the answer would only teach people to rephrase."]),
           shot("25-red-flag", "A flagged request: the warning above the answer. Compliance has been notified.", crop=REDFLAG_CROP),
           CondPageBreak(80 * mm),
           P("6.9 Department lead setup and company memory", "h2"),
           P("Set <b>Role \u2192 Department lead</b> in Admin \u2192 Users. The lead then gets a setup checklist on the home screen that ticks itself off as the steps are done, with reminders (at most 3): add at least 3 house rules, upload an SOP or policy, clear the suggested-answers queue, ask a first council question, record a first decision. Leads review suggested answers and write house rules in <b>Admin \u2192 Company memory</b>; admins see every department there and get a monthly improvement report."),
           shot("44-memory", "Admin \u2192 Company memory: house rules, suggested answers to review, approved answers and lead setup progress."),
           P("6.10 Settings for the loan tools", "h2"),
           table([["Setting", "Default", "Used by"],
                  ["NPL definition (days past due)", "90", "Portfolio report"],
                  ["Count restructured loans as NPL", "Yes", "Portfolio report"],
                  ["Portfolio report recipients", "none", "Email to Management"],
                  ["Maximum deductions (% of gross pay)", "60%", "Payslip affordability"],
                  ["Minimum net pay after the instalment", "RM 0", "Payslip affordability"],
                  ["Column Finance uses to hold a customer", "remarks Ain", "Notis blast"],
                  ["Remove customer details after", "90 days", "Notis blast, document templates"]],
                 [70, 30, 70]),
           CondPageBreak(80 * mm),
           P("6.11 Go-live checklist", "h2"),
           table([["", "Step", "Where"],
                  ["\u2610", "Replace the test staff directory with the HR export", "Admin \u2192 Staff directory \u2192 Import CSV"],
                  ["\u2610", "Add this year's public holidays (national and state)", "Admin \u2192 Action Crew & email"],
                  ["\u2610", "Set the public address staff use (APP_BASE_URL) and connect email (MAIL_PROVIDER = smtp or n8n)", "Server .env (IT)"],
                  ["\u2610", "Point the Council at the GPU server running Qwen 2.5 (OLLAMA_BASE_URL)", "Server .env (IT)"],
                  ["\u2610", "Create user accounts and set department leads", "Admin \u2192 Users"],
                  ["\u2610", "Upload each department's SOPs and policies", "Admin \u2192 Knowledge (leads can upload)"],
                  ["\u2610", "Decide who can use Council mode at first", "Admin \u2192 Settings"],
                  ["\u2610", "Set department leads (they receive the weekly digest)", "Admin \u2192 Users"],
                  ["\u2610", "Optional: Telegram bot. Create it with @BotFather and set TELEGRAM_BOT_TOKEN", "Server .env (IT)"],
                  ["\u2610", "Optional: voice. Start the voice profile and set WHISPER_URL", "Server (IT)"],
                  ["\u2610", "Connect the Collections mailbox for direct notis and template sending (NOTIS_SMTP_*)", "Server .env (IT)"],
                  ["\u2610", "Optional: PDF output for document templates. Run a Gotenberg converter and set PDF_CONVERTER_URL", "Server (IT)"],
                  ["\u2610", "Give Collections staff accounts in the Credit & Collections department (notis blast access)", "Admin \u2192 Users"],
                  ["\u2610", "Check System health shows Database, Redis and Ollama green", "Admin \u2192 Overview"]],
                 [8, 102, 60]),
           PageBreak()]

    # Part 5
    st += [P("7 · Privacy, safety and tips", "h1"),
           P("Built-in protections", "h2"),
           table([["Protection", "What it means for you"],
                  ["On-premises AI", "The model runs on Xanderia's GPU server. Your questions and documents are not sent to outside AI services."],
                  ["Personal data guard", "IC numbers, account numbers, phone numbers, emails and names are detected. If an outside model is ever enabled, such content is kept on-premises or removed first. Task emails never contain IC or account numbers."],
                  ["Your approval first", "No task email, reminder of a new task, or manager escalation is sent without the requester's approval. Runner drafts are never sent anywhere."],
                  ["Internal only", "Emails go only to addresses in the staff directory on allowed internal domains."],
                  ["Access control", "You only retrieve documents from your department and company-wide libraries, unless granted more."],
                  ["Audit trail", "Every model call, retrieval, email and status change is logged and cannot be altered."],
                  ["Your history, your choice", "Delete a conversation or your whole history at any time. Conversations older than the retention period (default 12 months) are deleted automatically."],
                  ["Counts, not content", "The heatmap and the weekly digest show numbers only. Your department lead can't read what you asked."],
                  ["Files and voice not kept", "Arrears, portfolio, deduction and payslip files are analysed in memory and never stored; only totals reach the AI. Notis and document-template data is deleted after 90 days. Voice recordings are transcribed on our own server and discarded."],
                  ["Red flags", "Requests that look like harassment, fraud, data misuse or discrimination are flagged to Compliance and logged."],
                  ["Telegram is outside", "Messages to the bot pass through Telegram's servers. Don't send customer personal data there; use the web app."]],
                 [40, 130]),
           P("Getting good answers", "h2"),
           *bullets(["<b>Give the numbers:</b> amounts, volumes, headcount, budget, deadlines. The advisors can't know Xanderia's figures unless you say them.",
                     "<b>Say what decision you face</b> (\u201cShould we \u2026 or \u2026?\u201d), not just a topic.",
                     "<b>Use Council for trade-offs</b> and <b>Quick for facts or how-tos.</b>",
                     "<b>Challenge the verdict:</b> click an open question, or ask \u201cWhat if the budget were half?\u201d",
                     "<b>Don't paste customer IC or account numbers</b> unless you really need to. Describe the situation instead."]),
           P("Frequently asked questions", "h2"),
           table([["Question", "Answer"],
                  ["How long does it take?", "Quick: a few seconds. Council: about 20\u201340 seconds, or about a minute with peer review. You can leave the page; a notification tells you when it's done."],
                  ["Can I ask in Bahasa Malaysia?", "Yes. You'll get the answer and verdict in BM. BM quality is a little weaker than English, so check important wording."],
                  ["Why did it ask me questions first?", "Important facts were missing. Answer them, or press Skip and it will proceed on the assumptions it listed."],
                  ["Is the verdict a decision?", "No. It is advice. The responsible staff and management decide. Legal and finance answers must be reviewed before acting."],
                  ["Why is a task \u201cUnassigned\u201d?", "No one in the staff directory holds that position. Choose the owner yourself; the system never guesses people."],
                  ["My email says \u201clink expired\u201d.", "Task links last 45 days. Open the Council and use Tasks instead."],
                  ["Can I change one thing and re-ask?", "Yes: press What if\u2026 under the verdict. It re-runs two advisors and updates the verdict in about half the time."],
                  ["Can I get the answer in Word?", "Yes: press Word under any answer. Draft a document turns it into an SOP, policy, letter or memo first."],
                  ["Does the council remember what we decided?", "Only if you press Record as decision. Then it asks you after 30 and 60 days whether it worked."],
                  ["Does the AI write the notis letters or template documents?", "No. The wording is your template; every value comes straight from the spreadsheet. The AI is only used to suggest which column fits a tag, and for the portfolio commentary."],
                  ["A notis draft opens read-only.", "The drafts need classic Outlook for Windows. In new Outlook or Outlook on the web, use the letters zip instead."],
                  ["Where is this guide in the app?", "Press the ? button at the top of any page, or next to EN / BM in the sidebar."],
                  ["Who do I contact?", "Your department lead for access or knowledge documents; the AI Systems team for anything else."]],
                 [48, 122])]

    st += [PageBreak(), P("8 · Complete feature list", "h1"),
           P("Everything the Xanderia AI Council can do, and where to find it.", "lead"),
           catalogue([
               ("Asking and answers", [
                   ("Auto, Quick and Council modes", "Auto lets the router choose. Quick gives one fast answer from a department advisor; Council convenes the advisors and the Chairman.", "Question box"),
                   ("Choose the department", "Ask as your own department or another one; its expert answers. You still see only documents you have access to.", "Question box"),
                   ("Council templates", "Guided forms: new product launch, collections strategy change, vendor selection, hiring plan, policy or SOP draft, customer script check.", "Templates button; home screen"),
                   ("Clarifying questions", "Before a council run it may ask up to 3 short questions if key facts are missing. Answer them, or press Skip to go ahead on its stated assumptions.", "Automatic"),
                   ("Follow-ups", "Continue the conversation; the council remembers the verdict. Click an open question to answer it and have the council reconsider.", "Under an answer"),
                   ("Live progress", "Watch the stages and advisors' opinions stream in. Leave the page if you like: a notification tells you when it's done.", "Automatic"),
                   ("Fair queue", "Quick questions are served before council work; you see your place in the queue when the model is busy.", "Automatic"),
                   ("Sources", "Answers based on the knowledge base cite the document and page, section or sheet as [S1], [S2].", "Under an answer"),
                   ("Answers in BM", "Ask in Bahasa Malaysia and the answer or verdict comes back in BM.", "Automatic"),
                   ("Attach documents", "PDF, Word, Excel, CSV or text attached to a question; the council judges the plan in it.", "Paperclip in the question box"),
                   ("Company memory", "Lessons from outcomes, approved company answers and house rules recalled for similar questions.", "Automatic; Suggest as company answer"),
                   ("In-app guide", "The ? button opens this guide at the part for the current page.", "Top of each page; sidebar"),
               ]),
               ("The council", [
                   ("Six advisors and a Chairman", "Contrarian, First Principles Thinker, Expansionist, Customer Advocate, Executor and the Department Expert answer independently; the Chairman decides.", "Council mode"),
                   ("Compliance seat", "A Compliance Officer joins for Credit & Collections, Legal & Compliance, Finance and HR (configurable).", "Automatic"),
                   ("Peer review (optional)", "Advisors critique each other anonymously and score each answer 1\u20135 before the Chairman decides.", "Question box checkbox"),
                   ("Structured verdict", "Decision, why, disagreements resolved (with the reason), action plan with owners and timing, risks rated by likelihood and impact, open questions, confidence.", "Council answer"),
                   ("Advisor stances", "For / Conditional / Against with a conviction score, and a bar showing how the council split.", "Advisor opinions"),
                   ("What if\u2026", "Change one assumption; two advisors re-run and the Chairman updates the verdict.", "Under a verdict"),
               ]),
               ("Reports and documents", [
                   ("Analytics report (PDF)", "Executive summary, stance map, peer scores, risk heat map, action-plan timeline, disagreements and every advisor's full opinion.", "Download report (PDF)"),
                   ("Export PDF", "Any quick answer as a PDF.", "Under an answer"),
                   ("Word download", "Any answer as an editable .docx.", "Word, under an answer"),
                   ("Draft a document", "SOP, policy, customer letter or staff memo written from an answer, with [TO CONFIRM] markers.", "Under an answer"),
                   ("Customer script checker", "OK to send / Needs changes / Do not send, an issues table, and a rewrite in English and BM.", "Templates"),
                   ("Share", "A read-only link for a signed-in colleague; revocable; every view is logged.", "Under an answer"),
                   ("Copy and feedback", "Copy the text; thumbs up or down with an optional comment to improve the prompts.", "Under an answer"),
               ]),
               ("Decisions and follow-through", [
                   ("Record as decision", "Add a verdict to the register, visible to your department or the whole company.", "Under a verdict"),
                   ("Decision register", "Search and filter decisions; status, action-plan progress and latest outcome.", "Sidebar \u2192 Decisions"),
                   ("Outcome check-ins", "At 30 and 60 days, a notification and email ask whoever recorded it whether it worked.", "Bell and email"),
                   ("Outcomes", "Worked, partly, did not work or too early, with a note.", "Decision page"),
                   ("Meeting brief", "A one-page summary of the decisions in a date range, for a management meeting.", "Decisions \u2192 Meeting brief"),
               ]),
               ("Action Crew", [
                   ("Put into action", "The Dispatcher splits the action plan into tasks with owners from the staff directory, working-day due dates and dependencies. It never invents people.", "Under a verdict"),
                   ("Launch plan and approval", "Review owners, dates and each email; approve per task or all at once. Nothing is sent before you approve.", "Launch plan screen"),
                   ("Herald emails", "Short task emails in business hours, to internal addresses only, with one-click Accept / Need help / Mark done / Can't do links.", "Email"),
                   ("Tracker", "Reminds owners who haven't acknowledged and before due dates; nudges you when overdue (remind, snooze, reassign); proposes manager escalation for your approval.", "Automatic; bell"),
                   ("Runner", "Drafts writing tasks (SOPs, templates, summaries) for you to review.", "Task board"),
                   ("Task board and Tasks", "Sent \u2192 Accepted \u2192 In progress \u2192 Blocked \u2192 Done; your assigned tasks and the plans you started.", "Plan page; sidebar \u2192 Tasks"),
                   ("Notifications", "Plan ready, accepted/done, needs help, overdue, escalation requests, check-ins, stale documents, red flags.", "Bell"),
               ]),
               ("Tools", [
                   ("Instalment", "Monthly instalment, total interest and payable, flat or reducing balance, EIR.", "Sidebar \u2192 Tools"),
                   ("Early settlement rebate", "Rule of 78 vs straight-line rebate and settlement amount.", "Tools"),
                   ("Roll rates", "Share of each bucket rolling one bucket worse between two month-ends.", "Tools"),
                   ("Cost to collect", "Cost per RM 1 collected, % of collections, cost per account resolved.", "Tools"),
                   ("Arrears file analysis", "CSV/XLSX export \u2192 DPD buckets by branch and product; not stored; only totals go to the council.", "Tools \u2192 Arrears file"),
                   ("Ask the council about this", "Puts the figures from any tool into a new question.", "Every tool"),
                   ("Portfolio report", "Month-end export \u2192 NPL, PAR, buckets, breakdowns, vintage, roll rates; saved months, trend, commentary, PDF, email.", "Tools \u2192 Portfolio report"),
                   ("Deduction reconciliation", "Loans vs employer/Angkasa deductions: not deducted, short, over, unknown; CSV.", "Tools \u2192 Deduction reconciliation"),
                   ("Payslip affordability", "Payslip extractor report \u2192 verdict against the deduction limit, largest instalment allowed, flags, credit memo.", "Tools \u2192 Payslip affordability"),
               ]),
               ("Collections letters and documents", [
                   ("Notis blast", "Masterlist \u2192 checked rows \u2192 missed-deduction letters and Outlook drafts; not-sent list; send log; direct sending when connected.", "Sidebar \u2192 Notis blast"),
                   ("Document templates", "Word template with {{tags}} + spreadsheet \u2192 one document per row; tag matching, formats, conditions, file names, email drafts.", "Sidebar \u2192 Doc templates"),
                   ("Make tag", "Select text in a template preview to turn it into a tag.", "Doc templates \u2192 Template"),
               ]),
               ("Ways in", [
                   ("Web app", "Works in any browser, on desktop and phone.", "Council address"),
                   ("Telegram bot", "Ask from Telegram; /quick, /council, /new, /help, /unlink; voice notes; answers with a link to the full report.", "Sidebar \u2192 Telegram"),
                   ("Voice questions", "Speak in English or BM; transcribed on our own server.", "Microphone in the question box"),
                   ("EN / BM screens", "The whole app in English or Bahasa Malaysia, saved to your account.", "EN / BM toggle"),
               ]),
               ("Your history and privacy", [
                   ("History", "Search, pin, rename and delete conversations; delete your whole history at any time.", "Sidebar"),
                   ("Retention", "Conversations older than the retention period (default 12 months) are deleted automatically.", "Automatic"),
                   ("On-premises AI", "Qwen 2.5 (14B) runs on Xanderia's own GPU server; no outside AI service is used.", "Automatic"),
                   ("Personal data guard", "IC, account and phone numbers, emails and names are detected and never sent to an outside model.", "Automatic"),
                   ("Red-flag detector", "Requests that look like harassment, fraud, data misuse or discrimination get a warning and are flagged to Compliance.", "Automatic"),
                   ("Access control", "You retrieve only your department's and company-wide documents, unless granted more.", "Automatic"),
                   ("Audit log", "Every sign-in, question (by reference), model call, retrieval, email and change is logged and cannot be edited.", "Admin \u2192 Audit log"),
               ]),
               ("Administration", [
                   ("Users and invites", "Add users with roles (employee, department lead, admin); invite email to set their own password; resend invite; forgot-password link; extra knowledge access; weekly-digest opt-out.", "Admin \u2192 Users"),
                   ("Departments", "Departments with English and BM names.", "Admin \u2192 Departments"),
                   ("Personas and prompts", "Layered prompts (base, persona, department, task), versioned with rollback, and a test sandbox.", "Admin \u2192 Personas & prompts"),
                   ("Model routing", "The model and settings for each role; upgrade the model without a redeploy.", "Admin \u2192 Model routing"),
                   ("Knowledge base", "Upload PDF, Word, Excel, text; per department or company-wide; review intervals and stale-document alerts.", "Admin \u2192 Knowledge"),
                   ("Staff directory", "Who the Action Crew may assign and email; CSV import from HR.", "Admin \u2192 Staff directory"),
                   ("Action Crew and email", "Allowed domains, business hours, weekend, public holidays, reminder and escalation timings, agent names, and the email outbox.", "Admin \u2192 Action Crew & email"),
                   ("Overview", "System health (database, queue, Ollama), 30-day usage, latency and feedback.", "Admin \u2192 Overview"),
                   ("Ask-the-org heatmap", "Which departments ask about which areas; counts only.", "Admin \u2192 Overview"),
                   ("Weekly digest", "Monday email to each department lead: questions, decisions, outcomes, overdue tasks, documents to review; counts only. Preview and send now.", "Admin \u2192 Overview"),
                   ("Settings", "Who may use Council mode, retention, peer review default, clarifying questions, knowledge base, weekly digest, compliance-seat departments, loan-tool settings.", "Admin \u2192 Settings"),
                   ("Company memory", "House rules, suggested answers to review, approved answers, lead setup progress, monthly improvement report.", "Admin \u2192 Company memory"),
               ]),
           ])]

    doc.build(st, onFirstPage=cover, onLaterPages=footer)


if __name__ == "__main__":
    out = HERE / "Xanderia-AI-Council-User-Guide.pdf"
    build(out)
    for f in IMG.glob("_*-crop.jpg"):
        f.unlink()
    print(out)
