#!/usr/bin/env python3
"""Build the review PDF (docs/facility-scheduler-mockups.pdf) from the artboards in docs/mockups.

One screen per landscape-Letter page. Fonts are downloaded once and embedded, so the
PDF renders identically without network access. Needs a Chromium binary — set CHROME
if it is not at the default path.

    python3 tools/build_review_pdf.py
"""
import base64, json, os, re, subprocess, sys, tempfile, urllib.request

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "mockups")
OUT = os.environ.get("OUT_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs"))
CHROME = os.environ.get("CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
LOGO_BLOB = "/_blob/276a6e8e1ad0852476b2eb89afb293e4"
LOGO_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "brand", "jr-chargers-logo.png")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
FONT_CSS = ("https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700"
            "&family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500&display=swap")

PAGE_W, PAGE_H = 1056, 816          # 11in x 8.5in at 96dpi
PAD_X, PAD_T, PAD_B = 40, 32, 28
HEAD_H = 112        # section eyebrow + title + caption (up to two lines)
STAGE_MT, FOOT_H = 10, 20
STAGE_W = PAGE_W - 2 * PAD_X
STAGE_H = PAGE_H - PAD_T - PAD_B - HEAD_H - STAGE_MT - FOOT_H

SECTIONS = {0: "1 · Access and coach scheduling",
            1220: "2 · Approval flow",
            2680: "3 · Super admin setup"}

CAPTIONS = {
    "Main.dc.html": "Passwordless sign-in. Access is by invitation — an address that isn't on the approved list can't get in, even with a valid link.",
    "SignInSent.dc.html": "Confirmation after requesting a link, with the resend and the 'not on the list' explanation.",
    "CoachCalendar.dc.html": "The main screen. Seven day columns, 30-minute rows. Solid crimson is reserved, dashed-over-stripes is pending, grey hatch is closed. Empty slots are click targets.",
    "RequestBooking.dc.html": "Start times already taken are struck out; lengths that would overrun the next booking are disabled. Nothing submittable can be rejected for a clash.",
    "MyRequests.dc.html": "Every request the team has made and where it stands, with the approver's reason on anything declined.",
    "ApproverQueue.dc.html": "Queue on the left, decision on the right: who asked, their note, an explicit conflict check, and the rest of that day. Approve is solid; Decline is the outline.",
    "ApprovalEmail.dc.html": "The approver's request email and the coach's decision email. Approving from the email and from the queue do the same thing.",
    "MobileCalendar.dc.html": "One day as a list of slots. Open slots are tappable — this is how most coaches will actually book.",
    "MobileRequest.dc.html": "The same request flow as a sheet, with unavailable lengths disabled and the reason stated.",
    "AdminUsers.dc.html": "The email allowlist — this list is the access control. Email, name, team, role, status, plus bulk invite.",
    "AdminHours.dc.html": "Open and close times per weekday with a week-at-a-glance bar, plus dated closures for holidays and maintenance.",
    "AdminRules.dc.html": "Block size, maximum length, timing and per-team limits, who receives requests, and the email options.",
}


def fetch_fonts():
    req = urllib.request.Request(FONT_CSS, headers={"User-Agent": UA})
    css = urllib.request.urlopen(req, timeout=60).read().decode()
    blocks, kept = css.split("@font-face"), []
    for b in blocks[1:]:
        # latin only — keeps the PDF small and covers every glyph used
        if "U+0000-00FF" not in b:
            continue
        url = re.search(r"url\((https://[^)]+\.woff2)\)", b).group(1)
        data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60).read()
        b64 = base64.b64encode(data).decode()
        b = re.sub(r"url\(https://[^)]+\.woff2\)",
                   "url(data:font/woff2;base64,%s)" % b64, b)
        kept.append("@font-face" + b.split("}")[0] + "}")
    print("  embedded %d font faces" % len(kept), file=sys.stderr)
    return "\n".join(kept)


def logo_data_uri():
    return "data:image/png;base64," + base64.b64encode(open(LOGO_FILE, "rb").read()).decode()


def board_markup(name, logo):
    s = open(os.path.join(SRC, name)).read()
    return s.split("</helmet>", 1)[1].split("</x-dc>", 1)[0].strip().replace(LOGO_BLOB, logo)


def main():
    os.makedirs(OUT, exist_ok=True)
    index = json.load(open(os.path.join(SRC, "canvas.json")))
    boards, order = index["boards"], index["order"]

    print("fetching fonts…", file=sys.stderr)
    fonts = fetch_fonts()
    logo = logo_data_uri()

    pages = []

    # ---- cover -------------------------------------------------------------
    toc = []
    for i, name in enumerate(order, start=2):
        toc.append(
            '<div style="display:flex;gap:14px;padding:7px 0;border-top:1px solid #E4E4E4;">'
            '<span style="width:34px;font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:#767676;">%02d</span>'
            '<span style="flex-grow:1;font-family:\'Barlow Condensed\',sans-serif;font-size:19px;font-weight:600;'
            'text-transform:uppercase;letter-spacing:0.02em;">%s</span>'
            '<span style="font-family:\'Barlow Condensed\',sans-serif;font-size:14px;font-weight:600;letter-spacing:0.1em;'
            'text-transform:uppercase;color:#767676;">%s</span></div>'
            % (i, boards[name].get("title", name), SECTIONS[boards[name]["y"]].split("·")[1].strip()))

    legend = [
        ("Reserved", "solid crimson, team name in white", "background:#AD0303;"),
        ("Pending", "crimson dashed outline over stripes — the slot is held and the team is named",
         "background:repeating-linear-gradient(135deg,#F7DADA 0 4px,#FFFFFF 4px 8px);border:1.5px dashed #AD0303;"),
        ("Closed", "grey hatch — outside that day's hours, or a closure date",
         "background:repeating-linear-gradient(135deg,#DFDFDF 0 3px,#EFEFEF 3px 6px);border:1px solid #CCCCCC;"),
    ]
    legend_html = "".join(
        '<div style="display:flex;align-items:center;gap:11px;padding:6px 0;">'
        '<span style="width:26px;height:18px;border-radius:2px;flex-shrink:0;%s"></span>'
        '<span style="font-family:\'Barlow Condensed\',sans-serif;font-size:17px;font-weight:700;text-transform:uppercase;'
        'width:104px;flex-shrink:0;">%s</span>'
        '<span style="font-size:13px;color:#555555;">%s</span></div>' % (sw, k, v)
        for k, v, sw in legend)

    pages.append(("""
<section class="page cover">
  <div class="coverbar">
    <img src="__LOGO__" alt="Hamilton Jr Chargers" style="height:78px;display:block;">
  </div>
  <div class="coverbody">
    <div style="display:flex;gap:44px;">
      <div style="width:392px;flex-shrink:0;">
        <h1 style="margin:0;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:54px;line-height:0.95;text-transform:uppercase;letter-spacing:0.01em;">Facility<br>scheduler</h1>
        <div style="width:64px;height:4px;background:#AD0303;margin:14px 0;"></div>
        <p style="margin:0 0 18px 0;font-size:13.5px;line-height:1.6;color:#333333;">Screen mockups for review. Nothing is built yet &mdash; this is the design and the user flows, one screen per page.</p>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.14em;color:#AD0303;margin-bottom:4px;">HOW A BLOCK READS</div>
        %s
        <p style="margin:10px 0 0 0;font-size:12.5px;line-height:1.5;color:#555555;">Fill, outline and hatch rather than colour alone, so the three states hold up in greyscale.</p>
      </div>
      <div style="flex-grow:1;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.14em;color:#AD0303;margin-bottom:4px;">CONTENTS</div>
        %s
      </div>
    </div>
    <div style="margin-top:26px;padding-top:16px;border-top:2px solid #0A0A0A;display:flex;gap:34px;">
      <div style="flex:1;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.14em;color:#AD0303;margin-bottom:5px;">THE LOOP</div>
        <p style="margin:0;font-size:12.5px;line-height:1.55;color:#333333;">Coach picks an open slot and a length &rarr; the request hits the approver's inbox <em>and</em> the Approvals queue &rarr; approve or decline &rarr; the coach gets an email and the calendar updates. Whoever gets there first decides it.</p>
      </div>
      <div style="flex:1;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.14em;color:#AD0303;margin-bottom:5px;">SETTLED</div>
        <p style="margin:0;font-size:12.5px;line-height:1.55;color:#333333;">One location with a single bookable space &middot; pending blocks name the team holding them &middot; 30-minute blocks, 1.5 hours max &middot; club brand and logo throughout.</p>
      </div>
      <div style="flex:1;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.14em;color:#AD0303;margin-bottom:5px;">STILL OPEN</div>
        <p style="margin:0;font-size:12.5px;line-height:1.55;color:#333333;">The real team list (age groups here are samples) &middot; Google sign-in or magic link only &middot; whether any coach runs two teams &middot; what happens to a reserved block if an admin later narrows that day's hours.</p>
      </div>
    </div>
  </div>
  <div class="foot"><span>Hamilton Jr Chargers &middot; Indoor facility scheduler</span><span>Design review &middot; Sep 2026</span></div>
</section>""" % (legend_html, "".join(toc))).replace("__LOGO__", logo))

    # ---- one page per board ------------------------------------------------
    for i, name in enumerate(order, start=2):
        b = boards[name]
        w, h = b["w"], b["h"]
        scale = min(STAGE_W / w, STAGE_H / h, 1.0)
        pages.append("""
<section class="page">
  <div class="phead">
    <div>
      <div class="eyebrow">%s</div>
      <h2>%s</h2>
    </div>
    <div class="pnum">%02d</div>
  </div>
  <div class="cap">%s</div>
  <div class="stage">
    <div class="board" style="width:%dpx;height:%dpx;transform:scale(%.4f);">%s</div>
  </div>
  <div class="foot"><span>Hamilton Jr Chargers · Indoor facility scheduler</span><span>%s</span></div>
</section>""" % (SECTIONS[b["y"]], b.get("title", name), i, CAPTIONS.get(name, ""),
                 w, h, scale, board_markup(name, logo), "Screen %d of %d" % (i - 1, len(order))))

    doc = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Facility Scheduler — screen mockups</title>
<style>
%s
*{box-sizing:border-box}
@page{size:%dpx %dpx;margin:0}
html,body{margin:0;padding:0;background:#FFFFFF;color:#0A0A0A;font-family:Barlow,system-ui,sans-serif;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
a{color:#AD0303;text-decoration:none}
.page{position:relative;width:%dpx;height:%dpx;padding:%dpx %dpx %dpx %dpx;overflow:hidden;
  page-break-after:always;break-after:page;background:#FFFFFF}
.page:last-child{page-break-after:auto;break-after:auto}
.phead{display:flex;align-items:flex-start;gap:16px}
.eyebrow{font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:0.16em;
  text-transform:uppercase;color:#AD0303}
.phead h2{margin:4px 0 0 0;font-family:'Barlow Condensed',sans-serif;font-size:30px;font-weight:700;line-height:1;
  text-transform:uppercase;letter-spacing:0.01em}
.pnum{margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:13px;color:#949494}
.cap{margin-top:7px;font-size:12.5px;line-height:1.5;color:#555555;max-width:860px}
.stage{position:relative;height:%dpx;margin-top:%dpx;display:flex;justify-content:center}
.board{flex-shrink:0;transform-origin:top center;overflow:hidden;box-shadow:0 0 0 1px #DDDDDD}
.foot{position:absolute;left:%dpx;right:%dpx;bottom:12px;display:flex;justify-content:space-between;
  font-family:'Barlow Condensed',sans-serif;font-size:11.5px;font-weight:600;letter-spacing:0.12em;
  text-transform:uppercase;color:#AAAAAA}
.cover{padding:0}
.coverbar{height:124px;background:#FFFFFF;border-bottom:4px solid #AD0303;display:flex;align-items:center;padding:0 %dpx}
.coverbody{padding:28px %dpx 0 %dpx}
</style></head>
<body>%s</body></html>""" % (fonts, PAGE_W, PAGE_H, PAGE_W, PAGE_H, PAD_T, PAD_X, PAD_B, PAD_X,
                             STAGE_H, STAGE_MT, PAD_X, PAD_X, PAD_X, PAD_X, PAD_X, "".join(pages))

    html_path = os.path.join(tempfile.mkdtemp(prefix="mockups-"), "mockups.html")
    open(html_path, "w").write(doc)
    print("wrote %s (%.0f KB)" % (html_path, len(doc) / 1024), file=sys.stderr)

    pdf_path = os.path.join(OUT, "facility-scheduler-mockups.pdf")
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
                    "--no-pdf-header-footer", "--virtual-time-budget=20000",
                    "--print-to-pdf=" + pdf_path, "file://" + html_path],
                   check=True, capture_output=True)
    print("wrote %s (%.0f KB)" % (pdf_path, os.path.getsize(pdf_path) / 1024), file=sys.stderr)


if __name__ == "__main__":
    main()
