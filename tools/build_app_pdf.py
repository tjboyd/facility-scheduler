#!/usr/bin/env python3
"""Build the as-built review PDF (docs/facility-scheduler-app.pdf).

The companion to build_review_pdf.py. That one renders the *design* artboards;
this one photographs the *running app*, which is what you want once something is
actually built and the two have drifted.

    npm run build && PORT=3000 npm start > server.log 2>&1 &
    node tools/capture_screens.mjs /tmp/app-screens
    python3 tools/build_app_pdf.py /tmp/app-screens

Fonts are embedded, so the PDF renders identically with no network access.
"""
import base64, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_review_pdf import CHROME, fetch_fonts, logo_data_uri  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = os.environ.get("OUT_DIR", os.path.join(ROOT, "docs"))

PAGE_W, PAGE_H = 1056, 816          # 11in x 8.5in at 96dpi
PAD_X, PAD_T, PAD_B = 44, 30, 26
HEAD_H = 142                        # eyebrow + title + caption, up to three lines
FOOT_H = 18
STAGE_W = PAGE_W - 2 * PAD_X
STAGE_H = PAGE_H - PAD_T - PAD_B - HEAD_H - FOOT_H

TITLES = {
    "01-signin": "Sign in",
    "02-check-email": "Check your inbox",
    "03-calendar": "The week",
    "04-release": "Giving a block back",
    "05-pickup": "Picking one up",
    "06-request": "Asking for time",
    "07-my-requests": "My requests",
    "08-approvals": "The approver's queue",
    "09-one-click": "Approved from the email",
    "10-phone-calendar": "The week, on a phone",
    "11-phone-request": "Asking, on a phone",
    "12-people": "People and access",
    "13-teams": "The club's teams",
    "14-schedule": "Assigned schedules",
    "15-hours": "Facility hours",
    "16-rules": "Booking rules",
}


def data_uri(path):
    return "data:image/png;base64," + base64.b64encode(open(path, "rb").read()).decode()


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/app-screens"
    shots = json.load(open(os.path.join(src, "manifest.json")))
    fonts = fetch_fonts()
    logo = logo_data_uri()

    contents = []
    for i, s in enumerate(shots, start=3):          # cover=1, contents=2
        name = s["file"].rsplit(".", 1)[0]
        contents.append(
            '<div class="crow"><span class="cnum">%d</span>'
            '<span class="csec">%s</span>'
            '<span class="ctitle">%s</span></div>' % (i, s["section"], TITLES.get(name, name)))

    pages = ['''<section class="page cover">
  <div class="coverbar"><img class="logo" src="%s"></div>
  <div class="coverbody">
    <div class="eyebrow">Indoor facility scheduler</div>
    <h1 class="covertitle">How it works</h1>
    <p class="coverlede">Every screen of the built app, in the order somebody meets them:
      signing in, seeing the week, asking for time, deciding it, and setting the place up.
      These are photographs of the running app, not drawings.</p>
    <p class="covernote">Hamilton Jr Chargers &middot; %d screens</p>
  </div>
</section>
<section class="page">
  <div class="head"><div class="eyebrow">Contents</div><h2 class="title">What is in here</h2></div>
  <div class="contents">%s</div>
  <div class="foot">Hamilton Jr Chargers &middot; indoor facility scheduler</div>
</section>''' % (logo, len(shots), "".join(contents))]

    for i, s in enumerate(shots, start=3):
        name = s["file"].rsplit(".", 1)[0]
        pages.append('''<section class="page">
  <div class="head">
    <div class="eyebrow">%s</div>
    <h2 class="title">%s</h2>
    <p class="caption">%s</p>
  </div>
  <div class="stage"><img class="shot%s" src="%s"></div>
  <div class="foot"><span>Hamilton Jr Chargers &middot; indoor facility scheduler</span><span>%d</span></div>
</section>''' % (s["section"], TITLES.get(name, name), s["caption"],
                 " phone" if s["phone"] else "", data_uri(os.path.join(src, s["file"])), i))

    doc = """<!doctype html><html><head><meta charset="utf-8"><style>
%s
@page { size: %dpx %dpx; margin: 0; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Barlow',sans-serif;color:#0A0A0A;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:%dpx;height:%dpx;padding:%dpx %dpx %dpx;background:#F4F4F4;
      page-break-after:always;display:flex;flex-direction:column;position:relative}
.page:last-child{page-break-after:auto}
.head{height:%dpx;flex-shrink:0}
.eyebrow{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;
         letter-spacing:.16em;text-transform:uppercase;color:#AD0303}
.title{font-family:'Barlow Condensed',sans-serif;font-size:40px;font-weight:700;
       letter-spacing:.01em;text-transform:uppercase;line-height:1;margin:5px 0 9px}
.caption{font-size:14.5px;line-height:1.5;color:#3A3A3A;max-width:92%%}
.stage{height:%dpx;display:flex;align-items:center;justify-content:center}
.shot{max-width:100%%;max-height:100%%;object-fit:contain;
      border:1px solid #D8D8D8;border-radius:5px;background:#FFFFFF;
      box-shadow:0 2px 10px rgba(0,0,0,.09)}
.shot.phone{border-radius:16px;border:6px solid #111111;box-shadow:0 3px 14px rgba(0,0,0,.16)}
.foot{height:%dpx;display:flex;justify-content:space-between;align-items:flex-end;
      font-family:'Barlow Condensed',sans-serif;font-size:11.5px;letter-spacing:.12em;
      text-transform:uppercase;color:#9A9A9A}
.cover{padding:0;background:#FFFFFF}
.coverbar{height:132px;background:#FFFFFF;border-bottom:4px solid #AD0303;
          display:flex;align-items:center;padding:0 %dpx}
.logo{height:70px;width:auto}
.coverbody{padding:54px %dpx 0}
.covertitle{font-family:'Barlow Condensed',sans-serif;font-size:82px;font-weight:700;
            letter-spacing:.01em;text-transform:uppercase;line-height:.96;margin:7px 0 22px}
.coverlede{font-size:19px;line-height:1.6;color:#3A3A3A;max-width:660px}
.covernote{margin-top:40px;font-family:'Barlow Condensed',sans-serif;font-size:13px;
           letter-spacing:.14em;text-transform:uppercase;color:#9A9A9A}
.contents{flex-grow:1;padding-top:6px;column-count:2;column-gap:44px}
.crow{display:flex;align-items:baseline;gap:12px;padding:7px 0;
      border-bottom:1px solid #E2E2E2;break-inside:avoid}
.cnum{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:#9A9A9A;width:20px;flex-shrink:0}
.csec{font-family:'Barlow Condensed',sans-serif;font-size:11.5px;letter-spacing:.1em;
      text-transform:uppercase;color:#AD0303;width:150px;flex-shrink:0}
.ctitle{font-size:14.5px}
</style></head><body>%s</body></html>""" % (
        fonts, PAGE_W, PAGE_H, PAGE_W, PAGE_H, PAD_T, PAD_X, PAD_B,
        HEAD_H, STAGE_H, FOOT_H, PAD_X, PAD_X, "".join(pages))

    html_path = os.path.join(tempfile.mkdtemp(prefix="appshots-"), "app.html")
    open(html_path, "w").write(doc)
    print("wrote %s (%.0f KB)" % (html_path, len(doc) / 1024), file=sys.stderr)

    pdf_path = os.path.join(OUT, "facility-scheduler-app.pdf")
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
                    "--no-pdf-header-footer", "--virtual-time-budget=30000",
                    "--print-to-pdf=" + pdf_path, "file://" + html_path],
                   check=True, capture_output=True)
    print("wrote %s (%.0f KB)" % (pdf_path, os.path.getsize(pdf_path) / 1024), file=sys.stderr)


if __name__ == "__main__":
    main()
