export type TranslateRequest = {
  language: string;
  strings: { id: string; text: string }[];
};

export type TranslateResponse = {
  translations: { id: string; text: string }[];
  skipped?: { id: string; reason: string }[];
};

export type TranslateError = {
  error: string;
};
