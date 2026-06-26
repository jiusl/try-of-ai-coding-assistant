---
name: write-ppt
version: "1.0.0"
description: 使用 python-pptx 库自动生成 PowerPoint 演示文稿的详细指南，包含所有核心 API、代码模板和最佳实践
author: user
tags: [ppt, presentation, python-pptx, office, automation, document]
category: productivity
---

# write-ppt Skill

使用 `python-pptx` 库自动生成 PowerPoint 演示文稿的完整指南。

---

## 环境准备

### 安装

```bash
pip install python-pptx
```

### 验证安装

```python
import pptx
print(pptx.__version__)  # 应 >= 1.0.0
```

---

## 核心概念：三要素

| 要素 | 说明 | 关键 API |
|------|------|----------|
| **Presentation** | 文档对象 | `pptx.Presentation()` |
| **Slide Layout** | 幻灯片布局 | `prs.slide_layouts[i]` |
| **Shape** | 形状（文本框/图片/表格等） | `slide.shapes.*` |

---

## 1. 创建 / 打开 Presentation

```python
from pptx import Presentation
from pptx.util import Inches, Pt, Cm, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.chart import XL_CHART_TYPE
from pptx.chart.data import CategoryChartData
from pptx.enum.shapes import MSO_SHAPE

# 从默认模板创建
prs = Presentation()

# 从已有文件打开（推荐：使用公司模板继承主题色）
# prs = Presentation('template.pptx')

# 设置宽屏 16:9
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

# 文档属性
prs.core_properties.title = '演示文稿标题'
prs.core_properties.author = '作者'
prs.core_properties.subject = '主题'

# 保存
prs.save('output.pptx')
```

---

## 2. Slide Layout 索引对照表

标准主题的 9 种布局：

| 索引 | 名称 | 说明 |
|------|------|------|
| 0 | **Title Slide** | 标题幻灯片（标题 + 副标题） |
| 1 | **Title and Content** | 标题 + 内容（带项目符号） |
| 2 | Section Header | 节标题 |
| 3 | Two Content | 两栏内容 |
| 4 | Comparison | 比较布局 |
| 5 | **Title Only** | 仅标题 |
| 6 | **Blank** | 空白（最灵活） |
| 7 | Content with Caption | 内容+说明 |
| 8 | Picture with Caption | 图片+说明 |

> ⚠️ 自定义模板的布局顺序可能不同，请先用 PowerPoint 的"幻灯片母版视图"确认。

---

## 3. 五种核心幻灯片模板

### 3.1 标题页（layout[0]）

```python
slide = prs.slides.add_slide(prs.slide_layouts[0])
slide.shapes.title.text = "项目汇报"
slide.placeholders[1].text = "2024年度工作总结\n汇报人：张三\n2024年12月"
```

### 3.2 内容页 - 项目符号列表（layout[1]）

```python
slide = prs.slides.add_slide(prs.slide_layouts[1])
slide.shapes.title.text = "核心内容"

body = slide.placeholders[1]
tf = body.text_frame
tf.text = "第一点：需求分析"          # 一级
p = tf.add_paragraph()
p.text = "用户调研"                    # 二级
p.level = 1
p = tf.add_paragraph()
p.text = "竞品分析"
p.level = 1
p = tf.add_paragraph()
p.text = "第二点：技术方案"            # 一级
p.level = 0
```

### 3.3 空白页 + 自由文本框（layout[6]）

```python
slide = prs.slides.add_slide(prs.slide_layouts[6])

txBox = slide.shapes.add_textbox(Inches(1), Inches(1.5), Inches(8), Inches(3))
tf = txBox.text_frame
tf.word_wrap = True

# 第一个段落
p = tf.paragraphs[0]
p.text = "大标题"
p.font.size = Pt(36)
p.font.bold = True
p.font.color.rgb = RGBColor(0x1A, 0x3C, 0x6E)  # 深蓝
p.alignment = PP_ALIGN.CENTER

# 第二个段落
p = tf.add_paragraph()
p.text = "副标题/描述文字"
p.font.size = Pt(18)
p.font.color.rgb = RGBColor(0x66, 0x66, 0x66)   # 灰色
p.alignment = PP_ALIGN.CENTER
p.space_before = Pt(12)

# 垂直对齐
tf.vertical_anchor = MSO_ANCHOR.MIDDLE
```

### 3.4 仅标题页（layout[5]）

```python
slide = prs.slides.add_slide(prs.slide_layouts[5])
slide.shapes.title.text = "章节标题页"
```

### 3.5 分节标题页（layout[2]）

```python
slide = prs.slides.add_slide(prs.slide_layouts[2])
slide.shapes.title.text = "Part 2"
slide.placeholders[1].text = "核心技术方案"
```

---

## 4. 富文本格式（Run 级别控制）

```python
slide = prs.slides.add_slide(prs.slide_layouts[6])
txBox = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(4))
tf = txBox.text_frame

# 段落1
p = tf.paragraphs[0]
p.text = "标题文字"
p.font.size = Pt(28)
p.font.bold = True
p.font.name = 'Arial'
p.font.color.rgb = RGBColor(0x33, 0x33, 0x33)
p.alignment = PP_ALIGN.CENTER

# 段落2 - 同一个段落内不同颜色（使用 Run）
p2 = tf.add_paragraph()
run1 = p2.add_run()
run1.text = "普通文字 "
run1.font.size = Pt(14)

run2 = p2.add_run()
run2.text = "高亮文字"
run2.font.size = Pt(14)
run2.font.bold = True
run2.font.color.rgb = RGBColor(0xE0, 0x3E, 0x2D)  # 红色

run3 = p2.add_run()
run3.text = " 继续普通"
run3.font.size = Pt(14)

# 段落间距
p2.space_before = Pt(12)
p2.space_after = Pt(6)
p2.line_spacing = Pt(24)    # 固定行距
# p2.line_spacing = 1.5     # 多倍行距
```

---

## 5. 表格

```python
slide = prs.slides.add_slide(prs.slide_layouts[5])
slide.shapes.title.text = "数据统计表"

rows, cols = 5, 4
table_shape = slide.shapes.add_table(
    rows, cols,
    Inches(1), Inches(2),
    Inches(11), Inches(4)
)
table = table_shape.table

# 设置列宽
table.columns[0].width = Inches(3)
table.columns[1].width = Inches(2.5)
table.columns[2].width = Inches(2.5)
table.columns[3].width = Inches(3)

# 表头
headers = ['项目', 'Q1', 'Q2', 'Q3']
for j, h in enumerate(headers):
    cell = table.cell(0, j)
    cell.text = h
    # 表头背景色
    cell.fill.solid()
    cell.fill.fore_color.rgb = RGBColor(0x1A, 0x3C, 0x6E)
    # 表头文字颜色
    for para in cell.text_frame.paragraphs:
        para.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        para.font.bold = True

# 数据
data = [['收入', '120万', '150万', '180万'],
        ['成本', '80万', '95万', '110万'],
        ['利润', '40万', '55万', '70万'],
        ['增长率', '-', '37.5%', '27.3%']]
for i, row in enumerate(data):
    for j, val in enumerate(row):
        table.cell(i+1, j).text = val

# 交替行颜色
table.first_row = True
table.first_col = True
table.horz_banding = True
```

---

## 6. 图表

### 6.1 柱状图 / 折线图

```python
slide = prs.slides.add_slide(prs.slide_layouts[5])
slide.shapes.title.text = "销售趋势"

chart_data = CategoryChartData()
chart_data.categories = ['1月', '2月', '3月', '4月', '5月', '6月']
chart_data.add_series('产品A', (42, 55, 68, 72, 85, 96))
chart_data.add_series('产品B', (30, 45, 52, 58, 63, 71))

chart_frame = slide.shapes.add_chart(
    XL_CHART_TYPE.COLUMN_CLUSTERED,   # 簇状柱形图
    Inches(1), Inches(2),
    Inches(11), Inches(5),
    chart_data
)
chart = chart_frame.chart

# 替代：折线图
# XL_CHART_TYPE.LINE_MARKERS

chart.chart_style = 10
chart.has_title = True
chart.chart_title.text_frame.text = "2024年上半年销售趋势"
chart.chart_title.text_frame.paragraphs[0].font.size = Pt(16)

chart.has_legend = True
chart.legend.position = XL_LEGEND_POSITION.BOTTOM
chart.legend.include_in_layout = False

# 坐标轴
chart.value_axis.has_major_gridlines = True
chart.value_axis.minimum_scale = 0
chart.value_axis.maximum_scale = 100

# 分类轴
chart.category_axis.tick_labels.font.size = Pt(11)
chart.category_axis.has_major_gridlines = False
```

### 6.2 饼图

```python
pie_data = CategoryChartData()
pie_data.categories = ['市场部', '研发部', '销售部', '行政部']
pie_data.add_series('预算', (35, 40, 15, 10))

pie_frame = slide.shapes.add_chart(
    XL_CHART_TYPE.PIE,
    Inches(1), Inches(2),
    Inches(5.5), Inches(5),
    pie_data
)

pie = pie_frame.chart
pie.has_legend = True
pie.legend.position = XL_LEGEND_POSITION.BOTTOM
# 显示数据标签
pie.plot.has_data_labels = True
data_labels = pie.plot.data_labels
data_labels.show_category_name = True
data_labels.show_percentage = True
data_labels.font.size = Pt(10)
```

---

## 7. 图片

```python
slide = prs.slides.add_slide(prs.slide_layouts[6])

# 方式1：原始尺寸
# pic = slide.shapes.add_picture('chart.png', Inches(1), Inches(1))

# 方式2：指定宽度（自动等比例）
pic = slide.shapes.add_picture(
    'chart.png',
    Inches(1), Inches(1.5),
    width=Inches(8)          # 高度自动计算
)

# 方式3：指定宽高（拉伸）
# pic = slide.shapes.add_picture(
#     'chart.png',
#     Inches(1), Inches(1.5),
#     width=Inches(10), height=Inches(5.5)
# )
```

---

## 8. 自选图形（AutoShape）

```python
slide = prs.slides.add_slide(prs.slide_layouts[6])

# 矩形
rect = slide.shapes.add_shape(
    MSO_SHAPE.RECTANGLE,
    Inches(1), Inches(1),
    Inches(4), Inches(1.5)
)
rect.text = "主要模块"
rect.fill.solid()
rect.fill.fore_color.rgb = RGBColor(0x00, 0x70, 0xC0)
for p in rect.text_frame.paragraphs:
    p.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    p.font.size = Pt(18)
    p.alignment = PP_ALIGN.CENTER

# 圆角矩形
rounded = slide.shapes.add_shape(
    MSO_SHAPE.ROUNDED_RECTANGLE,
    Inches(5.5), Inches(1),
    Inches(3), Inches(1.5)
)
rounded.text = "子功能"
rounded.fill.solid()
rounded.fill.fore_color.rgb = RGBColor(0x4C, 0xAF, 0x50)

# 箭头
arrow = slide.shapes.add_shape(
    MSO_SHAPE.RIGHT_ARROW,
    Inches(4.3), Inches(1.3),
    Inches(1), Inches(0.6)
)
```

---

## 9. 幻灯片背景设置

```python
slide = prs.slides.add_slide(prs.slide_layouts[6])

# 取消继承母版（必须先设置，否则背景不生效）
slide.follow_master_background = False

# 纯色背景
background = slide.background
fill = background.fill
fill.solid()
fill.fore_color.rgb = RGBColor(0xF5, 0xF5, 0xF5)  # 浅灰

# 渐变背景
# fill.gradient()
# fill.gradient_angle = 90
# stops = fill.gradient_stops
# stops[0].color.rgb = RGBColor(0x1A, 0x3C, 0x6E)
# stops[0].position = 0.0
# stops[1].color.rgb = RGBColor(0x4C, 0x6E, 0x9A)
# stops[1].position = 1.0
```

---

## 10. 完整实战模板

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.chart import XL_CHART_TYPE
from pptx.chart.data import CategoryChartData
from pptx.enum.shapes import MSO_SHAPE

def create_presentation():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    prs.core_properties.title = '演示文稿'
    prs.core_properties.author = 'AI助手'

    # === 第1页：标题页 ===
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = "2024年度项目汇报"
    slide.placeholders[1].text = "技术研发中心\n2024年12月"

    # === 第2页：目录 ===
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "目  录"
    tf = slide.placeholders[1].text_frame
    tf.clear()
    items = [
        ("01  项目概述", 0),
        ("02  核心成果", 0),
        ("03  数据分析", 0),
        ("04  下一步计划", 0),
    ]
    for i, (text, level) in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = text
        p.level = level
        p.font.size = Pt(24)
        p.font.color.rgb = RGBColor(0x33, 0x33, 0x33)

    # === 第3页：关键数据表格 ===
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    slide.shapes.title.text = "关键指标"
    rows, cols = 5, 4
    table_shape = slide.shapes.add_table(
        rows, cols,
        Inches(1), Inches(2),
        Inches(11), Inches(4)
    )
    table = table_shape.table
    headers = ['指标', 'Q1', 'Q2', 'Q3']
    data = [
        ['营收(万)', '120', '150', '180'],
        ['利润(万)', '30', '45', '55'],
        ['用户数(万)', '10', '18', '28'],
        ['满意度', '92%', '94%', '96%'],
    ]
    for j, h in enumerate(headers):
        table.cell(0, j).text = h
    for i, row in enumerate(data):
        for j, val in enumerate(row):
            table.cell(i+1, j).text = val
    table.first_row = True
    table.horz_banding = True

    # === 第4页：图表 ===
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    slide.shapes.title.text = "营收趋势"
    chart_data = CategoryChartData()
    chart_data.categories = ['Q1', 'Q2', 'Q3', 'Q4']
    chart_data.add_series('营收', (120, 150, 180, 210))
    chart_data.add_series('利润', (30, 45, 55, 70))
    chart_frame = slide.shapes.add_chart(
        XL_CHART_TYPE.COLUMN_CLUSTERED,
        Inches(1), Inches(2),
        Inches(11), Inches(5),
        chart_data
    )
    chart = chart_frame.chart
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM

    # === 第5页：结尾 ===
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    txBox = slide.shapes.add_textbox(Inches(3), Inches(2.5), Inches(7), Inches(2))
    tf = txBox.text_frame
    tf.text = "谢谢！Q&A"
    tf.paragraphs[0].font.size = Pt(44)
    tf.paragraphs[0].font.bold = True
    tf.paragraphs[0].font.color.rgb = RGBColor(0x1A, 0x3C, 0x6E)
    tf.paragraphs[0].alignment = PP_ALIGN.CENTER

    prs.save('output.pptx')
    return prs

if __name__ == '__main__':
    create_presentation()
```

---

## 11. PPT 写作指南

### 内容原则
- **10/20/30 法则**：10页以内 / 20分钟演讲 / 30号以上字体
- **结论先行**：每页标题即核心观点
- **一页一事**：每页只讲一个要点

### 设计原则
- 字体：标题 28-36pt，正文 16-24pt
- 颜色：每页不超过 3 种主色
- 对齐：保持视觉一致性
- 留白：适当留白提升可读性

### 常见 PPT 框架

**工作汇报型**：封面 → 摘要 → 数据（图表+表格）→ 问题与挑战 → 计划 → 结尾

**数据分析型**：封面 → 背景目的 → 数据概览 → 趋势分析 → 细分分析 → 洞察 → 建议

**产品推介型**：封面 → 痛点 → 方案 → 优势 → 案例 → 团队 → 合作方式 → 结尾

### 配色方案推荐

| 方案 | 主色 | 辅色 | 适合场景 |
|------|------|------|----------|
| 沉稳商务 | #1A3C6E | #4C6E9A | 工作汇报 |
| 清新科技 | #0070C0 | #00B0F0 | 产品介绍 |
| 活力橙色 | #E06A2D | #F5A623 | 市场方案 |
| 简约黑白 | #333333 | #F5F5F5 | 创意提案 |

---

## 单位换算

```python
from pptx.util import Inches, Pt, Cm, Emu

inch = Inches(1)    # 1英寸 = 914400 EMU
cm   = Cm(1)        # 1厘米
pt   = Pt(12)       # 12磅字体
emu  = Emu(914400)
```

---

## 常用枚举速查

```python
# 图表类型
# XL_CHART_TYPE.COLUMN_CLUSTERED  - 柱状图
# XL_CHART_TYPE.LINE_MARKERS      - 折线图
# XL_CHART_TYPE.PIE               - 饼图
# XL_CHART_TYPE.BAR_CLUSTERED     - 条形图
# XL_CHART_TYPE.AREA              - 面积图

# 自选图形
# MSO_SHAPE.RECTANGLE          - 矩形
# MSO_SHAPE.ROUNDED_RECTANGLE  - 圆角矩形
# MSO_SHAPE.OVAL               - 椭圆
# MSO_SHAPE.RIGHT_ARROW        - 右箭头
# MSO_SHAPE.PARALLELOGRAM      - 平行四边形

# 对齐方式
# PP_ALIGN.LEFT   - 左对齐
# PP_ALIGN.CENTER - 居中
# PP_ALIGN.RIGHT  - 右对齐

# 垂直锚点
# MSO_ANCHOR.TOP    - 顶部
# MSO_ANCHOR.MIDDLE - 居中
# MSO_ANCHOR.BOTTOM - 底部

# 图例位置
# XL_LEGEND_POSITION.BOTTOM - 底部
# XL_LEGEND_POSITION.RIGHT  - 右侧
# XL_LEGEND_POSITION.TOP    - 顶部