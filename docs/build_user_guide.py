"""Builds docs/Xanderia-AI-Council-User-Guide.pdf  (python docs/build_user_guide.py)

Screenshots live in docs/guide-images/ (captured from the running app with Playwright).
"""
from pathlib import Path

from PIL import Image as PILImage
from reportlab.graphics.shapes import Drawing, Line, Polygon, Rect, String
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
    node(d, 355, 30, 127, 50, "Hermes 3 on the GPU server", "Ollama: hermes3:8b and\nnomic-embed-text\n(on-premises)", dark=True)
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
    c.drawString(20 * mm, h - 104 * mm, "Xanderia Services Sdn Bhd  ·  Internal  ·  September 2026  ·  Runs on-premises on Hermes 3")
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
                  ["2. Features at a glance", "Everyone", "Every feature on one page"],
                  ["3. Using it", "All staff", "Asking, the council, reading a verdict, the report, sharing, putting a plan into action, tasks you receive"],
                  ["4. Doing more", "All staff", "Templates, script checker, what-if, drafting documents and Word, the decision register, calculators, arrears files, Telegram, voice, Bahasa Malaysia screens"],
                  ["5. Running it", "Admins, department leads", "Users and invites, staff directory, Action Crew and email, knowledge and freshness, prompts, models, heatmap, weekly digest, red flags, go-live checklist"],
                  ["6. Privacy, safety and tips", "Everyone", "What stays on-premises, what needs approval, good questions, timing, FAQ"]],
                 [42, 38, 90]),
           Spacer(1, 6),
           tip("Everything the Council says is <b>advice</b>. Final decisions sit with the responsible staff and management. Legal and finance answers must be reviewed before acting.", "Remember"),
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
           P("The AI model (Hermes 3) runs on Xanderia's own GPU server. Questions, documents and verdicts are not sent to any outside AI service. Every model call is written to an audit log.", "body"),
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
                  ["Peer review (optional)", "Advisors critique each other anonymously and score each answer 1\u20135. Adds about a minute and a half."],
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
           P("A full council takes about 1\u20132 minutes, or about 3 with peer review. Quick questions from colleagues are always served first.", "small"),
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
           P("Shortcuts for common jobs, ways to test and record decisions, working tools for collections and finance, and other ways to ask.", "lead"),
           P("4.1 Start from a template", "h2"),
           P("Press <b>Templates</b> in the question box, or pick one on the home screen. A template asks for the facts the council needs (goal, numbers, constraints, deadline), so it goes straight to work without clarifying questions."),
           shot("22-templates", "Templates on the home screen: council templates for decisions, a Quick one for drafting, and the script checker.", crop=TEMPLATES_CROP),
           shot("23-template-dialog", "A template form. Fill in what you know; empty fields are left out.", crop=DIALOG_CROP, width=120 * mm),
           P("4.2 Check a customer script before it goes out", "h2"),
           P("Use the <b>Check a customer script</b> template for SMS, WhatsApp, letters or call scripts, especially collections messages. The Customer Advocate checks tone, clarity, fair treatment (no threats or misleading statements), and PDPA (no personal data a third party could see). It returns <b>OK to send</b>, <b>Needs changes</b> or <b>Do not send</b>, a table of issues, and a rewrite in English and BM."),
           shot("24-script-check", "Script check result: the verdict, each issue with the reason, and a compliant rewrite.", crop=SCRIPT_CROP),
           CondPageBreak(90 * mm),
           P("4.3 Ask “what if…”", "h2"),
           P("Under a council verdict, press <b>What if…</b> and change one assumption (“only 40% accept”, “the budget is halved”, “we launch in Q3 instead”). The <b>Contrarian</b> and the <b>Executor</b> re-run on the new assumption, the other advisors' opinions carry over, and the Chairman updates the verdict and says what changed. It takes about half as long as a full council."),
           shot("27-whatif-form", "What if…: type the changed assumption and press Re-run.", crop=WHATIF_FORM_CROP),
           shot("26-whatif", "The updated verdict appears as a new answer in the same conversation, so you can compare it with the original.", crop=WHATIF_CROP),
           CondPageBreak(90 * mm),
           P("4.4 Draft a document, and download Word", "h2"),
           *steps(["Under any answer, press <b>Draft a document</b> and pick <b>SOP</b>, <b>Policy</b>, <b>Customer letter</b> or <b>Staff memo</b>.",
                   "The draft is written from the answer, with anything you must confirm marked <b>[TO CONFIRM]</b>.",
                   "Press <b>Word</b> under the draft (or any answer) to download an editable .docx with headings, lists and tables."]),
           shot("28-draft-picker", "Draft a document: choose the type.", crop=DRAFT_PICKER_CROP),
           shot("29-draft-memo", "A staff memo drafted from a council verdict, ready to download as Word.", crop=DRAFT_CROP),
           CondPageBreak(90 * mm),
           P("4.5 The decision register", "h2"),
           P("When you act on a verdict, press <b>Record as decision</b> under it. Choose whether your department or the whole company can see it. The register (sidebar → <b>Decisions</b>) lists who decided what and when, the action-plan progress, and the latest outcome."),
           shot("30-decisions", "Decisions: search and filter by department and status.", crop=DECISIONS_CROP),
           *bullets(["<b>Outcome check-ins:</b> 30 and 60 days after a decision, whoever recorded it gets a notification and email: <i>did it work?</i> Record <b>Worked</b>, <b>Partly</b>, <b>Did not work</b> or <b>Too early to tell</b>, with a note. Numbers help (“roll rate fell from 8% to 6%”).",
                     "<b>Meeting brief:</b> pick a date range and press <b>Write brief</b> for a one-page summary of the decisions in that period, including progress and outcomes, ready for a management meeting."]),
           shot("31-decision-detail", "A decision: the verdict it came from, its status, and the outcomes recorded so far.", crop=DECISION_DETAIL_CROP),
           shot("32-meeting-brief", "A meeting brief written from the register.", crop=BRIEF_CROP),
           CondPageBreak(90 * mm),
           P("4.6 Calculators", "h2"),
           P("Sidebar → <b>Tools</b>. The calculations run in your browser; nothing is sent until you press <b>Ask the council about this</b>, which puts the figures into a new question for you to finish."),
           table([["Calculator", "What it gives you"],
                  ["Instalment", "Monthly instalment, total interest and total payable, flat rate or reducing balance, and the effective interest rate (EIR) of a flat-rate loan."],
                  ["Early settlement rebate", "The rebate of unearned interest under Rule of 78 and straight-line, the settlement amount, and the difference to the customer. Check which method the agreement requires."],
                  ["Roll rates", "Enter bucket balances at two month-ends; see the share that rolled one bucket worse (Current → 1–30 → … → 91+). Rolls above 30% are shown in red."],
                  ["Cost to collect", "Cost per RM 1 collected, cost as a % of collections, and cost per account resolved."]],
                 [38, 132]),
           Spacer(1, 6),
           shot("33-calculator", "The instalment calculator. RM 20,000 at 8% flat over 60 months is an EIR of about 14%.", crop=CALC_CROP),
           CondPageBreak(90 * mm),
           P("4.7 Analyse an arrears file", "h2"),
           P("<b>Tools → Arrears file.</b> Upload a collections export (.csv or .xlsx, one row per account) with a days-past-due column. Balance, branch and product columns are used if present; English and BM column names are recognised (“DPD”, “Hari tertunggak”, “Baki”, “Cawangan”). You get the balance in each DPD bucket, and each branch and product with its bucket mix and 91+ share. <b>Ask the council about this file</b> sends only these totals, never customer rows. The file itself is not stored."),
           shot("35-arrears", "Arrears file analysis (sample data). One branch stands out with 28% of its balance 91+ days past due.", crop=ARREARS_CROP),
           CondPageBreak(80 * mm),
           P("4.8 Ask from Telegram", "h2"),
           P("If IT has switched the bot on, click <b>Telegram</b> in the sidebar, press <b>Connect Telegram</b>, and open the link on your phone. It works once and expires in 15 minutes. Then message the bot like the Council itself:"),
           table([["You send", "What happens"],
                  ["A question", "Auto mode: a quick answer, or the full council for plans and decisions. The answer comes back in the chat, with a link to the full report."],
                  ["/quick … or /council …", "Force Quick or Council. A council verdict takes 1–3 minutes; the bot tells you it has started."],
                  ["A voice note", "Transcribed on our own server, then answered (if voice is enabled)."],
                  ["/new, /help, /unlink", "Start a new conversation (follow-ups within 6 hours continue the last one), show help, or disconnect."]],
                 [40, 130]),
           Spacer(1, 4),
           tip("Telegram is an outside service. Messages pass through Telegram's servers, so <b>never send customer personal data</b> (IC, account or phone numbers) through the bot. Everything asked from Telegram also appears in your Council history, marked [Telegram].", "Important"),
           P("4.9 Ask by voice", "h2"),
           P("Press the <b>microphone</b> in the question box, speak in English or Bahasa Malaysia, and press it again. The words appear in the box for you to check and send. Transcription runs on Xanderia's own server (Whisper); the recording is not stored."),
           shot("39-voice", "The microphone button next to Send (shown when voice is enabled).", crop=VOICE_CROP, width=130 * mm),
           P("4.10 Bahasa Malaysia screens", "h2"),
           P("Switch the whole app between English and BM with the <b>EN / BM</b> toggle (on the sign-in page, in the sidebar and at the top of each page). Your choice is saved to your account. Answers follow the language of your question, whichever screen language you use."),
           shot("40-bm-tools", "The Tools page in Bahasa Malaysia.", crop=BM_CROP),
           PageBreak()]

    # Part 5
    st += [P("5 · Running it (admins and department leads)", "h1"),
           P("Department leads see <b>Knowledge</b> for their own department. Admins see everything below under <b>Admin</b>.", "lead"),
           P("5.1 Users and invites", "h2"),
           P("<b>Admin → Users → Add user.</b> Leave the password empty and the new colleague gets an email (English and BM) with a link to set their own password, valid for 7 days. <b>Resend invite</b> issues a new link. Anyone can use <b>Forgot password?</b> on the sign-in page for a 1-hour reset link. Until email is connected, the invite link is shown on screen for you to pass on."),
           side_by_side(["41-invite-admin", "42-invite-set"], "Left: a new user with an invite link. Right: the page where they set their password."),
           P("5.2 Staff directory", "h2"),
           P("The Action Crew only assigns tasks and sends emails to people in this directory. Import the HR export as CSV with the columns <b>name, position, department, email, manager_email</b>. Re-importing updates people by email. Add or edit people one by one as needed."),
           shot("15-directory", "Admin \u2192 Staff directory. (The people shown are test entries.)"),
           P("5.3 Action Crew and email", "h2"),
           *bullets(["<b>Allowed email domains:</b> emails to any other domain are blocked.",
                     "<b>Business hours and weekend:</b> Kedah, Kelantan and Terengganu can use a Friday\u2013Saturday weekend.",
                     "<b>Reminder and escalation timings.</b> Escalation can be switched off.",
                     "<b>Public holidays:</b> add national and state holidays each year; no emails are sent and no working days are counted on them.",
                     "<b>Email outbox:</b> every email the Crew produced, with its status. By default emails are <b>only recorded, not sent</b>, until IT connects SMTP or n8n."]),
           shot("16-crew-admin", "Admin \u2192 Action Crew & email."),
           P("5.4 Knowledge base and review dates", "h2"),
           P("Upload SOPs, policies, product sheets and FAQs (PDF, Word, Excel, text). Choose who can retrieve each document: one department or company-wide. Staff only get answers from their own department's documents and company-wide ones, unless an admin grants extra access. Scanned PDFs without a text layer are rejected."),
           P("Every document has a <b>review interval</b> (30, 90, 180 or 365 days; 180 by default). When it passes, the document shows <b>Review due</b>, and the uploader and the department lead (or admins, for company-wide documents) get a notification. Check the document, then press <b>Mark reviewed</b>, upload a new version, or delete it. The council keeps quoting a stale document until you do."),
           shot("38-knowledge-fresh", "Admin \u2192 Knowledge: upload, review dates, and a document due for review.", crop=KNOWLEDGE_CROP),
           P("5.5 Personas, prompts and the test sandbox", "h2"),
           P("Each advisor's behaviour comes from short prompt layers (base \u2192 persona \u2192 department \u2192 task). Edit a layer and save it as a new version; any older version can be re-activated. Before saving, use <b>Test this prompt</b> to run your draft with a sample question and see the output and whether it still produces a valid verdict."),
           shot("18-prompts", "Admin \u2192 Personas & prompts, with version history and the test sandbox.", crop=(0, 0, 1920, 1300)),
           P("5.6 Models, audit and settings", "h2"),
           *bullets(["<b>Model routing:</b> the model and settings per role (Hermes 3 by default). Upgrading the model is a setting, not a redeploy.",
                     "<b>Audit log:</b> every login, question (by reference, not text), model call, document retrieval, email and status change. It cannot be edited.",
                     "<b>Settings:</b> who can use Council mode, retention (default 12 months), peer review default, clarifying questions on or off, knowledge base on or off, the weekly digest on or off, and which departments get the Compliance seat."]),
           side_by_side(["19-models", "20-audit"], "Left: model routing per role. Right: the audit log."),
           CondPageBreak(90 * mm),
           P("5.7 Ask-the-org heatmap and the weekly digest", "h2"),
           P("<b>Admin \u2192 Overview</b> shows which departments ask about which areas over the last 30 to 365 days. A heavy cell outside a department's own area (for example HR asking Finance questions) can point to a training need or an unclear policy. A red ring marks cells with red flags. Only counts are shown, never what anyone asked."),
           shot("37-digest", "The ask-the-org heatmap and questions per week.", crop=HEATMAP_CROP),
           P("Every Monday at 08:00, each <b>department lead</b> gets a digest email for their department: questions asked (and the trend), the areas asked about, decisions and outcomes recorded, overdue action tasks with owners, and documents due for review. Like the heatmap, it holds counts only, never question text. <b>Preview</b> shows what a department will receive; <b>Send now</b> sends this week's digests immediately. A lead can be taken off the list in Admin \u2192 Users."),
           shot("37-digest", "Digest preview for one department.", crop=DIGEST_CROP),
           P("5.8 Compliance seat and red flags", "h2"),
           *bullets(["<b>Compliance seat:</b> for the departments set in Admin \u2192 Settings (default Credit &amp; Collections, Legal &amp; Compliance, Finance and HR), a <b>Compliance Officer</b> joins the council. It checks the plan against the law, BNM guidance and internal policy, using the knowledge base.",
                     "<b>Red flags:</b> if a request looks like harassment, fraud, misuse of personal data or discrimination, the answer still comes, but with a warning, and admins and Legal &amp; Compliance leads get a notification. The flag is written to the audit log. Blocking the answer would only teach people to rephrase."]),
           shot("25-red-flag", "A flagged request: the warning above the answer. Compliance has been notified.", crop=REDFLAG_CROP),
           CondPageBreak(80 * mm),
           P("5.9 Go-live checklist", "h2"),
           table([["", "Step", "Where"],
                  ["\u2610", "Replace the test staff directory with the HR export", "Admin \u2192 Staff directory \u2192 Import CSV"],
                  ["\u2610", "Add this year's public holidays (national and state)", "Admin \u2192 Action Crew & email"],
                  ["\u2610", "Set the public address staff use (APP_BASE_URL) and connect email (MAIL_PROVIDER = smtp or n8n)", "Server .env (IT)"],
                  ["\u2610", "Point the Council at the GPU server running Hermes 3 (OLLAMA_BASE_URL)", "Server .env (IT)"],
                  ["\u2610", "Create user accounts and set department leads", "Admin \u2192 Users"],
                  ["\u2610", "Upload each department's SOPs and policies", "Admin \u2192 Knowledge (leads can upload)"],
                  ["\u2610", "Decide who can use Council mode at first", "Admin \u2192 Settings"],
                  ["\u2610", "Set department leads (they receive the weekly digest)", "Admin \u2192 Users"],
                  ["\u2610", "Optional: Telegram bot. Create it with @BotFather and set TELEGRAM_BOT_TOKEN", "Server .env (IT)"],
                  ["\u2610", "Optional: voice. Start the voice profile and set WHISPER_URL", "Server (IT)"],
                  ["\u2610", "Check System health shows Database, Redis and Ollama green", "Admin \u2192 Overview"]],
                 [8, 102, 60]),
           PageBreak()]

    # Part 5
    st += [P("6 · Privacy, safety and tips", "h1"),
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
                  ["Files and voice not kept", "Arrears files are analysed in memory and never stored; only totals reach the AI. Voice recordings are transcribed on our own server and discarded."],
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
                  ["How long does it take?", "Quick: a few seconds. Council: about 1\u20132 minutes, or about 3 with peer review. You can leave the page; a notification tells you when it's done."],
                  ["Can I ask in Bahasa Malaysia?", "Yes. You'll get the answer and verdict in BM. BM quality is a little weaker than English, so check important wording."],
                  ["Why did it ask me questions first?", "Important facts were missing. Answer them, or press Skip and it will proceed on the assumptions it listed."],
                  ["Is the verdict a decision?", "No. It is advice. The responsible staff and management decide. Legal and finance answers must be reviewed before acting."],
                  ["Why is a task \u201cUnassigned\u201d?", "No one in the staff directory holds that position. Choose the owner yourself; the system never guesses people."],
                  ["My email says \u201clink expired\u201d.", "Task links last 45 days. Open the Council and use Tasks instead."],
                  ["Can I change one thing and re-ask?", "Yes: press What if\u2026 under the verdict. It re-runs two advisors and updates the verdict in about half the time."],
                  ["Can I get the answer in Word?", "Yes: press Word under any answer. Draft a document turns it into an SOP, policy, letter or memo first."],
                  ["Does the council remember what we decided?", "Only if you press Record as decision. Then it asks you after 30 and 60 days whether it worked."],
                  ["Who do I contact?", "Your department lead for access or knowledge documents; the AI Systems team for anything else."]],
                 [48, 122])]

    doc.build(st, onFirstPage=cover, onLaterPages=footer)


if __name__ == "__main__":
    out = HERE / "Xanderia-AI-Council-User-Guide.pdf"
    build(out)
    for f in IMG.glob("_*-crop.jpg"):
        f.unlink()
    print(out)
