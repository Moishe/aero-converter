import fragmentSource from './shader.glsl?raw';

const VERTEX_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  // Flip V here rather than via UNPACK_FLIP_Y_WEBGL: that pixel-store flag is
  // not honored for ImageBitmap uploads (the app's load path), so doing the
  // flip in the shader keeps orientation correct for every source type.
  v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile error: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL not supported');

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1,
  ]), gl.STATIC_DRAW);
  const aPosition = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const u = {
    opacityR: gl.getUniformLocation(program, 'u_opacityR'),
    opacityG: gl.getUniformLocation(program, 'u_opacityG'),
    opacityB: gl.getUniformLocation(program, 'u_opacityB'),
    curveR: gl.getUniformLocation(program, 'u_curveR'),
    curveG: gl.getUniformLocation(program, 'u_curveG'),
    curveB: gl.getUniformLocation(program, 'u_curveB'),
    highlight: gl.getUniformLocation(program, 'u_highlight'),
    levelsBlack: gl.getUniformLocation(program, 'u_levelsBlack'),
    levelsWhite: gl.getUniformLocation(program, 'u_levelsWhite'),
    levelsGamma: gl.getUniformLocation(program, 'u_levelsGamma'),
  };

  let width = 0;
  let height = 0;

  function setImage(source) {
    // Orientation is handled in the vertex shader (see VERTEX_SOURCE); no
    // UNPACK_FLIP_Y_WEBGL here, as it is unreliable for ImageBitmap sources.
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    width = source.width;
    height = source.height;
    canvas.width = width;
    canvas.height = height;
  }

  function render(params) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(u.opacityR, params.opacityR);
    gl.uniform1f(u.opacityG, params.opacityG);
    gl.uniform1f(u.opacityB, params.opacityB);
    gl.uniform3f(u.curveR, params.curveR.gain, params.curveR.gamma, params.curveR.offset);
    gl.uniform3f(u.curveG, params.curveG.gain, params.curveG.gamma, params.curveG.offset);
    gl.uniform3f(u.curveB, params.curveB.gain, params.curveB.gamma, params.curveB.offset);
    gl.uniform2f(u.highlight, params.highlight.amount, params.highlight.threshold);
    gl.uniform3f(u.levelsBlack, params.levels.black[0], params.levels.black[1], params.levels.black[2]);
    gl.uniform3f(u.levelsWhite, params.levels.white[0], params.levels.white[1], params.levels.white[2]);
    gl.uniform3f(u.levelsGamma, params.levels.gamma[0], params.levels.gamma[1], params.levels.gamma[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function readPixels() {
    const data = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { data, width, height };
  }

  return { setImage, render, readPixels, gl };
}
