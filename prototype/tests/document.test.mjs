import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownHtml,exportHtml,htmlToMarkdown} from '../document.mjs';
test('exports render content without executing supplied markup',()=>{
 const md='# 林同学\n## 教育背景\n大学\n- **检索实现：** 保留引用。\n<img src=x onerror=alert(1)>';
 const html=markdownHtml(md);assert.ok(html.includes('<h1>林同学</h1>'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
 const page=exportHtml({name:'简历',markdown:md,styles:{fontSize:'999;evil',theme:'blue'}});assert.ok(page.includes('font-size:18px'));assert.ok(page.includes('@page'));assert.ok(!page.includes('data-quote'));
 assert.equal(htmlToMarkdown('<h1>姓名</h1><script>alert(1)</script><p>大学</p>'),'# 姓名\n大学');
});
