export function detectGraphicsCapability() {
  if ('gpu' in navigator) return 'webgpu';
  if (window.WebGL2RenderingContext) return 'webgl2';
  if (window.WebGLRenderingContext) return 'webgl';
  return 'canvas';
}
