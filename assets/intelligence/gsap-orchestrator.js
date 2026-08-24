// ClearGlass GSAP orchestration layer
export function initializeTimeline() {
  if (!window.gsap) return;

  gsap.timeline()
    .from('.hero', { opacity: 0, y: 40, duration: 1 })
    .from('.intelligence-node', { opacity: 0, scale: 0.8, stagger: 0.08 }, '-=0.5');
}
