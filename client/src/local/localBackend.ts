import type { Backend } from "../api/types";
import { critiqueScad, getProvidersConfig, streamChat } from "./chatBackend";
import { renderScad } from "./renderBackend";

export const localBackend: Backend = { streamChat, renderScad, critiqueScad, getProvidersConfig };
