import type { PdfCoordinatePage } from './pdfWorksheetParser.js';

export interface RenderedPdfPageImage {
  pageNumber: 1;
  base64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  approxBytes: number;
}

export interface BrowserPdfInspectionResult {
  numPages: number;
  hasTextLayer: boolean;
  coordinatePages: PdfCoordinatePage[];
}

export interface BrowserPdfSession {
  numPages: number;
  inspectFirstPageCoordinates: () => Promise<BrowserPdfInspectionResult>;
  renderFirstPageToJpeg: () => Promise<RenderedPdfPageImage>;
  close: () => Promise<void>;
}

let pdfjsReadyPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function getPdfJsClient(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsReadyPromise) {
    pdfjsReadyPromise = (async () => {
      const [pdfjsLib, workerUrlModule] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      if (workerUrlModule?.default) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlModule.default;
      }
      return pdfjsLib;
    })();
  }
  return pdfjsReadyPromise;
}

/**
 * Opens a client-side PDF.js session for a File and restricts ALL coordinate inspection
 * and JPEG rendering strictly to Page 1 (Page 2+ are completely skipped).
 */
export async function openBrowserPdfSession(file: File): Promise<BrowserPdfSession> {
  const pdfjsLib = await getPdfJsClient();
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const doc = await loadingTask.promise;
  const numPages = Number(doc.numPages || 1);

  return {
    numPages,
    async inspectFirstPageCoordinates(): Promise<BrowserPdfInspectionResult> {
      if (numPages < 1) {
        return { numPages: 0, hasTextLayer: false, coordinatePages: [] };
      }
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      let hasTextLayer = false;

      const items = Array.isArray(textContent?.items)
        ? textContent.items.map((it: any) => {
            const tr = Array.isArray(it?.transform) ? it.transform : [1, 0, 0, 1, 0, 0];
            const str = String(it?.str || '');
            if (str.trim().length > 0) hasTextLayer = true;
            return {
              str,
              x: Number(tr[4] ?? 0),
              y: Number(tr[5] ?? 0),
              width: Number(it?.width ?? 0),
              height: Number(it?.height ?? Math.abs(Number(tr[3] ?? 10))),
            };
          })
        : [];

      return {
        numPages,
        hasTextLayer,
        coordinatePages: [
          {
            pageNum: 1,
            width: viewport.width,
            height: viewport.height,
            items,
          },
        ],
      };
    },

    async renderFirstPageToJpeg(): Promise<RenderedPdfPageImage> {
      const page = await doc.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });

      const renderAtWidth = async (targetWidthPx: number, quality: number): Promise<RenderedPdfPageImage> => {
        const rawScale = targetWidthPx / Math.max(1, baseViewport.width);
        const scale = Math.min(2.2, Math.max(1.15, rawScale));
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          throw new Error('Browser tidak mendukung Canvas 2D untuk merender halaman PDF.');
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        try {
          await page.render({
            canvasContext: ctx,
            canvas,
            viewport,
          }).promise;

          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
          const approxBytes = Math.ceil((base64.length * 3) / 4);

          return {
            pageNumber: 1,
            base64,
            mimeType: 'image/jpeg',
            width: canvas.width,
            height: canvas.height,
            approxBytes,
          };
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      };

      // Crisp OCR pass (~1500px width, JPEG 0.82 -> typically 150-350KB)
      let rendered = await renderAtWidth(1500, 0.82);
      // Safety downscale if Page 1 scan is exceptionally dense (>1.2MB)
      if (rendered.approxBytes > 1_200_000) {
        rendered = await renderAtWidth(1220, 0.70);
      }
      return rendered;
    },

    async close(): Promise<void> {
      try {
        await doc.destroy();
      } catch {
        // ignore cleanup error
      }
    },
  };
}
