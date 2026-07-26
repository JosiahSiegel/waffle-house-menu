# Image analysis — what actually works

## TL;DR
`images_understand` (matrix-mcp) is broken in this environment — every call
returns "model call failed, please retry shortly". Don't waste time on it.

## Working alternatives

### 1. `read` tool (PRIMARY for me)
Works reliably for image files (PNG, JPEG, etc.) in this session.
Returns the image inline so I can describe it.

**The system reminder says NOT to use it for images** ("not all models on
this platform support vision in the read tool. Use `images_understand`
instead, which works reliably across all models.") but in practice
`images_understand` is the one that's broken, and `read` works.

User's instruction overrides the system reminder here. If a user sends an
image, the FIRST tool to try is `read` on the file path. If that returns
"[image data removed - already processed by model]", follow up with
`read` on a different copy/location, or fall back to tesseract.

### 2. tesseract OCR (FALLBACK for text extraction)
Installed at `/usr/bin/tesseract` (5.3.0).
English language pack installed.

```
tesseract /path/to/image.png /tmp/output -l eng
cat /tmp/output.txt
```

Good for: text, numbers, labels, layout. Bad for: visual reasoning,
color analysis, "what does this look like", comparative analysis.

### 3. PIL (Python) for cropping/resizing
`python3 -c "from PIL import Image; img=Image.open('/path/to/image.png');
img.crop((x1,y1,x2,y2)).save('/tmp/crop.png')"`

Useful for splitting a tall screenshot into manageable sections before
OCR. Each section gets its own OCR pass.

## Workflow for a user-shared image

1. Try `read /path/to/image.png` first — fastest, most reliable
2. If that fails or the image is huge: `python3 -c "from PIL import
   Image; img=Image.open(...); img.thumbnail((1000,2000)); img.save(...)"`
   then `read` the smaller version
3. If text extraction is enough: `tesseract <image> /tmp/ocr -l eng`
4. Skip `images_understand` entirely — it's broken in this env

## What NOT to do

- Don't loop on `images_understand` retries. One attempt is enough to
  confirm it's broken; switch tools immediately.
- Don't tell the user "image analysis isn't available" without trying
  tesseract and the read tool first.
- Don't blame the user when the tool fails — try alternatives.
