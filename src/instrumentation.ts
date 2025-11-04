import { register } from "@arizeai/phoenix-otel";

register({
  url: "http://localhost:6006/v1/traces",
  batch: false,
  projectName: "document-agent",
});
