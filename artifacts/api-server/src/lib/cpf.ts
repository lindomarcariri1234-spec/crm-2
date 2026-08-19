/**
 * CPF helpers now live in the shared workspace package so the API server and
 * the web frontend share a single implementation. Re-exported here under the
 * historical names to keep existing import paths (and test mocks) stable.
 */
export {
  cleanCpf as cleanCPF,
  isValidCpf as isValidCPF,
  validateCpfOrThrow as validateCPF,
} from "@workspace/shared";
