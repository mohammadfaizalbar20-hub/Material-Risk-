import type { PdfCoordinatePage } from './pdfWorksheetParser.js';

export interface RenderedPdfPageImage {
  pageNumber: number;
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
  inspectCoordinatePages: () => Promise<BrowserPdfInspectionResult>;
  renderPageToJpeg: (pageNumber: number) => Promise<RenderedPdfPageImage>;
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
 * Opens a client-side PDF.js session for a File so multi-page coordinate inspection
 * or page-by-page JPEG rendering parses the PDF binary only once and cleans up safely.
 */
export async function openBrowserPdfSession(file: File): Promise<BrowserPdfSession> {
  const pdfjsLib = await getPdfJsClient();
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const doc = await loadingTask.promise;
  const numPages = Number(doc.numPages || 1);

  return {
    numPages,
    async inspectCoordinatePages(): Promise<BrowserPdfInspectionResult> {
      const coordinatePages: PdfCoordinatePage[] = [];
      let hasTextLayer = false;

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();
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

        coordinatePages.push({
          pageNum,
          width: viewport.width,
          height: viewport.height,
          items,
        });
      }

      return { numPages, hasTextLayer, coordinatePages };
    },

    async renderPageToJpeg(pageNumber: number): Promise<RenderedPdfPageImage> {
      const page = await doc.getPage(pageNumber);
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
            pageNumber,
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

      // Primary crisp OCR pass (~1500px width, JPEG 0.82 -> typically 150-350KB)
      let rendered = await renderAtWidth(1500, 0.82);
      // Safety downscale if single page scan is exceptionally dense (>1.2MB)
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
