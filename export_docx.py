import sys, json, re, io
from docx import Document
from docx.shared import Pt, Mm, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

data = json.loads(sys.stdin.buffer.read().decode('utf-8'))
doc = Document()
layout = data.get('layout', {})
section = doc.sections[0]
section.page_width, section.page_height = Mm(210), Mm(297)
margin = min(30, max(8, float(layout.get('margin', 17))))
section.top_margin = section.bottom_margin = section.left_margin = section.right_margin = Mm(margin)
font = '宋体' if layout.get('font') == 'serif' else '微软雅黑'
size = min(18, max(9, float(layout.get('fontSize', 12))))
color = layout.get('accent', '#244b42')
if not re.match(r'^#[a-fA-F0-9]{6}$', color): color = '#244b42'
for name in ['Normal', 'Title', 'Heading 1', 'Heading 2', 'List Bullet']:
    st = doc.styles[name]
    st.font.name = font
    st.element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), font)
    st.font.size = Pt(size)
    st.paragraph_format.line_spacing = min(2.2, max(1.2, float(layout.get('lineHeight', 1.65))))
    st.paragraph_format.space_after = Pt(4)
for name, factor in [('Title', 1.9), ('Heading 1', 1.2), ('Heading 2', 1.05)]:
    doc.styles[name].font.size = Pt(size * factor)
    doc.styles[name].font.color.rgb = RGBColor.from_string(color[1:])
    doc.styles[name].paragraph_format.keep_with_next = True

def inline(p, text):
    for part in re.split(r'(\*\*.*?\*\*|\[[^\]]+\]\(https?://[^\s)]+\))', text):
        if part.startswith('**') and part.endswith('**'):
            p.add_run(part[2:-2]).bold = True
        else:
            link = re.fullmatch(r'\[([^\]]+)\]\((https?://[^\s)]+)\)', part)
            if link:
                h = OxmlElement('w:hyperlink')
                h.set(qn('r:id'), p.part.relate_to(link[2], 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', is_external=True))
                r = OxmlElement('w:r'); t = OxmlElement('w:t'); t.text = link[1]; r.append(t); h.append(r); p._p.append(h)
            else: p.add_run(part.replace('`', ''))

for line in data.get('markdown', '').splitlines():
    line = line.strip()
    if not line: continue
    if line == '---': continue
    if line.startswith('# '): p = doc.add_paragraph(style='Title'); text = line[2:]
    elif line.startswith('## '): p = doc.add_paragraph(style='Heading 1'); text = line[3:]
    elif line.startswith('### '): p = doc.add_paragraph(style='Heading 2'); text = line[4:]
    elif re.match(r'^[-*] ', line): p = doc.add_paragraph(style='List Bullet'); text = line[2:]
    else: p = doc.add_paragraph(); text = line
    inline(p, text)
buf = io.BytesIO(); doc.save(buf); sys.stdout.buffer.write(buf.getvalue())
