export const DOCUMENT_CODE = {
  FolderNotFound: "DOCUMENT_FOLDER_NOT_FOUND",
  DocumentNotFound: "DOCUMENT_NOT_FOUND",
  InvalidName: "DOCUMENT_INVALID_NAME",
  InvalidContent: "DOCUMENT_INVALID_CONTENT",
} as const;

export type DocumentCode = (typeof DOCUMENT_CODE)[keyof typeof DOCUMENT_CODE];

export class DocumentError extends Error {
  readonly code: DocumentCode;
  constructor(code: DocumentCode, message: string) {
    super(message);
    this.name = "DocumentError";
    this.code = code;
  }
}
