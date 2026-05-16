/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module '*.glsl?raw' {
  const src: string;
  export default src;
}
declare module '*.frag?raw' {
  const src: string;
  export default src;
}
declare module '*.vert?raw' {
  const src: string;
  export default src;
}
declare module '*.wgsl?raw' {
  const src: string;
  export default src;
}
