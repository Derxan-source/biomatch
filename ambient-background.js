(() => {
  const canvas = document.querySelector('#ambient-canvas');
  if (!canvas) return;

  // Em celulares, preserve o visual com gradientes CSS e não inicialize WebGL.
  if (window.matchMedia('(max-width: 600px), (pointer: coarse)').matches) {
    document.body.classList.add('ambient-fallback');
    return;
  }

  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    powerPreference: 'low-power',
  });
  if (!gl) {
    document.body.classList.add('ambient-fallback');
    return;
  }

  const vertexSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // Uma névoa orgânica de inspiração biológica, recolorida para o verde profundo do BioMatch.
  const fragmentSource = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec2 v_uv;
    uniform float u_time;
    uniform vec2 u_resolution;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 2; i++) {
        value += amplitude * noise(p);
        p = p * 2.02 + vec2(17.3, 9.2);
        amplitude *= 0.5;
      }
      return value;
    }
    void main() {
      vec2 uv = v_uv;
      uv.x *= u_resolution.x / u_resolution.y;
      float t = u_time * 0.16;
      vec2 warp = vec2(
        fbm(uv * 1.55 + vec2(t * 0.30, -t)),
        fbm(uv * 1.55 + vec2(5.1 - t * 0.18, t * 0.74))
      );
      float field = fbm(uv * 2.15 + warp * 1.65 + vec2(-t * 0.4, t * 0.16));
      float centerline = 0.53 + 0.13 * sin(uv.x * 2.4 + t * 0.72) + (warp.x - 0.5) * 0.22;
      float ribbon = 1.0 - smoothstep(0.04, 0.43, abs(uv.y - centerline));
      float cloud = smoothstep(0.36, 0.78, field) * ribbon;
      float haze = smoothstep(0.46, 0.87, fbm(uv * 1.1 + warp * 0.7 - vec2(t * 0.15)));
      float vein = pow(max(0.0, sin(field * 18.0 - t * 1.8)), 7.0) * cloud;

      vec3 base = vec3(0.043, 0.078, 0.074);
      vec3 forest = vec3(0.055, 0.185, 0.125);
      vec3 leaf = vec3(0.19, 0.39, 0.235);
      vec3 lime = vec3(0.67, 0.86, 0.36);
      vec3 color = mix(base, forest, cloud * 0.86 + haze * 0.08);
      color = mix(color, leaf, smoothstep(0.34, 0.9, cloud) * 0.38);
      color += lime * vein * 0.13;
      float vignette = 1.0 - smoothstep(0.18, 1.25, length((v_uv - 0.5) * vec2(0.85, 0.92)));
      color *= 0.77 + vignette * 0.23;
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) {
    document.body.classList.add('ambient-fallback');
    return;
  }

  const program = gl.createProgram();
  if (!program) {
    document.body.classList.add('ambient-fallback');
    return;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    document.body.classList.add('ambient-fallback');
    return;
  }

  gl.useProgram(program);
  const vertices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const timeLocation = gl.getUniformLocation(program, 'u_time');
  const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let visible = !document.hidden;
  let lastFrameAt = 0;

  function resize() {
    const cssWidth = Math.max(1, canvas.clientWidth);
    const cssHeight = Math.max(1, canvas.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(640000 / (cssWidth * cssHeight)));
    canvas.width = Math.max(1, Math.round(cssWidth * ratio));
    canvas.height = Math.max(1, Math.round(cssHeight * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw(performance.now());
  }
  function draw(now) {
    gl.uniform1f(timeLocation, reducedMotion.matches ? 0.0 : now * 0.00022);
    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function animate(now) {
    frame = 0;
    if (!visible || document.body.dataset.view !== 'home' || reducedMotion.matches) return;
    if (now - lastFrameAt >= 1000 / 24) {
      draw(now);
      lastFrameAt = now;
    }
    frame = requestAnimationFrame(animate);
  }
  function start() {
    if (visible && document.body.dataset.view === 'home' && !reducedMotion.matches && !frame) frame = requestAnimationFrame(animate);
    if (reducedMotion.matches) draw(0);
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }
  function onMotionChange() {
    stop();
    start();
  }
  function onViewChange() {
    if (document.body.dataset.view === 'home') start();
    else stop();
  }
  function onVisibilityChange() {
    visible = !document.hidden;
    if (visible) start();
    else stop();
  }

  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  reducedMotion.addEventListener('change', onMotionChange);
  new MutationObserver(onViewChange).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
  resize();
  start();
})();
