export type EditErrorCode =
  | "EDIT_CONFLICT"
  | "EDIT_INVALID"
  | "PATH_OUT_OF_BOUNDS"
  | "PERMISSION_DENIED"
  | "SECRET_FILE"
  | "WRITE_FAILED"
  | "CANCELLED";

export interface EditContext {
  path: string;
  contentHash: string;
  startLine?: number;
  endLine?: number;
  reason?: string;
}

export interface ValidatedEdit {
  path: string;
  targetPath: string;
  displayPath: string;
  originalContent: string;
  proposedContent: string;
  diff: string;
  contentHash: string;
  valid: boolean;
  error?: {
    message: string;
    code: EditErrorCode;
  };
}

export interface SafeEditOptions {
  expectedHash?: string;
  maxBytes?: number;
  signal?: AbortSignal;
}
