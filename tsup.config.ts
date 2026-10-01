import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom", "vosk-browser"],
  // esbuild drops a "use client" it finds inside a file, and tsup's treeshake
  // pass drops the banner that would put it back — so the banner stays and the
  // treeshaking goes. The hooks are the whole package; there is little to shake.
  banner: { js: '"use client";' },
  tsconfig: "tsconfig.build.json",
});
