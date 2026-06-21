export function isLiveImportPreviewStepComplete(input: {
  importableCount: number;
  previewErrorMessage: string | null;
  previewSource: string;
}) {
  return (
    input.previewSource !== "mock" &&
    input.previewSource !== "deferred" &&
    !input.previewErrorMessage &&
    input.importableCount > 0
  );
}
