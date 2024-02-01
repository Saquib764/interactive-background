// Function to dynamically load the Three.js library
async function load_script(url) {
  return new Promise((resolve, reject) => {
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = url; // Replace with the latest version

    script.onload = function() {
        resolve();
    };
    document.head.appendChild(script);
  })
}


function setup_renderer() {
  const renderer = new THREE.WebGLRenderer({
      antialias: true,
      // powerPreference: "high-performance",
      alpha: true,
      preserveDrawingBuffer: true,
  });
  renderer.setClearColor("#ffffff")
  // renderer.setPixelRatio(window.devicePixelRatio)
  // renderer.setSize(window.innerWidth, window.innerHeight)
  return renderer
}

function setup_scene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color( 0xf0f0f0 );
  return scene
}

function setup_camera() {
  const camera = new THREE.PerspectiveCamera(
    160,
    1.0,
    1,
    1000
  )
  camera.up.set(0, 1, 1);
  camera.position.set(0, -0, 20)
  camera.lookAt(0,0,0)
  return camera
}

function getImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.src = url;
    image.crossOrigin = "anonymous";

    image.onload = () => {
      resolve({
        height: image.height,
        width: image.width,
        url,
        base64Encode: () => base64EncodeImage(image),
        image
      });
    };
    image.onerror = () => reject();
  });
}

// Initialization function
async function init(parent, image_url, depth_url, scale, sensitivity, render_mode) {
  await load_script('https://cdn.jsdelivr.net/npm/three@0.126.1/build/three.min.js')

  // load jsfeat
  await load_script('https://cdn.jsdelivr.net/npm/jsfeat/build/jsfeat.js')
  // Set up your scene, camera, renderer, etc.
  const scene = setup_scene()
  const camera = setup_camera()
  const renderer = setup_renderer()


  parent.appendChild(renderer.domElement);

  const M = Math.pow(2, 32)

  let model;

  async function get_image_data(url, width, height) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
  
    const image = await getImageFromUrl(url);
    width = width || image.width
    height = height || image.height
  
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(image.image, 0, 0, width, height);
  
    return [image, ctx.getImageData(0, 0, width, height)]
  }
  function get_depth_32(depth_data){
    const width = depth_data.width || depth_data.cols
    const height = depth_data.height || depth_data.rows
    let data_u32 = new Uint32Array(depth_data.data.buffer);
    const depth = new jsfeat.matrix_t(width, height, jsfeat.F32_t | jsfeat.C1_t);
    for(let i=0; i<depth_data.data.length; i++) {
      depth.data[i] = data_u32[i]
    }
    return depth
  }

  function depth_to_3d(depth_data, image_data) {
    const points = []
    const colors = []
    const sizes = []
    let ox = 1.0 * image_data.width / 2
    let oy = 1.0 * image_data.height / 2
    let f = 0.001

    let corner_min = new THREE.Vector3(0, 0, 0)
    let corner_max = new THREE.Vector3(image_data.width, image_data.height, 0)

    for (let i = 0; i < image_data.width * image_data.height; i++) {
      const depth = depth_data.data[i] / M
      // const z = 100 * (depth - 1) 
      // const z = 1.0 / (depth + .001)
      const z = -300 *(depth + 0.5)

      const u = i % image_data.width
      const v = Math.floor(i / image_data.width)
      let x =  -(u - ox) * z * f
      let y =  (v - oy) * z * f
      points.push(new THREE.Vector3(x, y, z))
      if(i == 0) {
        corner_min.x = x
        corner_min.y = y
        corner_min.z = z
        corner_max.x = x
        corner_max.y = y
        corner_max.z = z
      }
      if(x < corner_min.x) {
        corner_min.x = x
      }
      if(y < corner_min.y) {
        corner_min.y = y
      }
      if(z < corner_min.z) {
        corner_min.z = z
      }
      if(x > corner_max.x) {
        corner_max.x = x
      }
      if(y > corner_max.y) {
        corner_max.y = y
      }
      if(z > corner_max.z) {
        corner_max.z = z
      }

      colors.push(image_data.data[i * 4]/255.0, image_data.data[i * 4 + 1]/255.0, image_data.data[i * 4 + 2]/255.0)
      sizes.push(Math.abs(200*f*z))
    }
    return [points, colors, sizes, corner_min, corner_max]
  }

  const vertexShader = `
  attribute float size;
  varying vec3 vColor;

  void main() {
      vColor = color;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (10.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
  }
  `

  const fragmentShader = `
  varying vec3 vColor;

  void main() {
      gl_FragColor = vec4(vColor, 1.0);
  }
  `
  function set_point_cloud(points, colors, sizes) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
  
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  
    const material = new THREE.ShaderMaterial({
      uniforms: {
          color: { value: new THREE.Color(0xffffff) }
      },
      vertexShader,
      fragmentShader,
      vertexColors: true
    });
  
  
    const pointCloud = new THREE.Points(geometry, material);
  
    return pointCloud
  }
  
  async function loadTexture(url) {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(url, resolve, undefined, reject);
    });
  }
  
  async function set_surface(image, points) {
    let texture = await loadTexture(image.url);
    texture.format = THREE.RGBAFormat;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
  
    let height = image.height
    let width = image.width
  
    let uvs = [];
    // create mesh surface from grid of points, with depth data
    // These points are vertices of the mesh
    const geometry = new THREE.BufferGeometry();
  
    let vertices = [];
    for (let h = 0; h < height ; h++) {
      for(let w = 0; w < width ; w++) {
        let i = h * width + w
        let point = points[i];
        vertices.push(point.x, point.y, point.z);
  
        uvs.push( w / width, 1 - h / height);
      }
    }
    // Add faces
    let faces = [];
    for (let i = 0; i < height - 1; i++) {
      for (let j = 0; j < width - 1; j++) {
        let index = i * width + j;
        faces.push(index, index + width, index + width + 1);
        faces.push(index, index + width + 1, index + 1);
      }
    }
  
  
    // Create a Float32Array from the vertices array
    let verticesArray = new Float32Array(vertices);
    let uvsArray = new Float32Array(uvs);
    let facesArray = new Uint32Array(faces);
  
    geometry.setAttribute('position', new THREE.BufferAttribute(verticesArray, 3));
    geometry.setIndex(new THREE.BufferAttribute(facesArray, 1));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvsArray, 2));
    geometry.computeVertexNormals();
    // let material = new THREE.MeshStandardMaterial({
    //   map: texture,
    //   roughness: 0.0,
    //   metalness: 0.10,
    // });
    let material = new THREE.MeshBasicMaterial({ map: texture});
    material.side = THREE.DoubleSide;
    let mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh
  }
  
  async function createWorld() {
    if(model) {
      scene.remove(model)
    }
    // let depth_data = await get_image_data(`/images/3d/${name}_depth_32.png`)
    let [image, image_data] = await get_image_data(image_url)
    let [depth, depth_data] = await get_image_data(depth_url, image_data.width, image_data.height)
    
    let gray_count = 0
    let gray_sample_n = 5
    for(let i = 0; i < gray_sample_n; i++) {
      let r = Math.floor(Math.random() * depth_data.height * depth_data.width)
      if(depth_data.data[r] == depth_data.data[r+1] && depth_data.data[r] == depth_data.data[r+2]) {
        gray_count += 1
      }
    }
  
    let depth_u8 = new jsfeat.matrix_t(depth_data.height, depth_data.width, jsfeat.U8_t | jsfeat.C1_t);
    jsfeat.imgproc.grayscale(depth_data.data, depth_data.height, depth_data.width, depth_u8);
  
  
    let depth_u32;
    depth_u32 = get_depth_32(depth_data)
    let options = {
      radius: 2,
      sigma: 1
    };
    let r = options.radius|0;
    let kernel_size = (r+1) << 1;
    // jsfeat.imgproc.gaussian_blur(depth_u32, depth_u32, kernel_size, options.sigma);

    // Sample array of 3D points
    const [points, colors, sizes, corner_min, corner_max] = depth_to_3d(depth_u32, image_data);
  
    camera.fov = 100 / scale
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    // renderer.aspect = image_data.width / image_data.height
    renderer.setSize(window.innerWidth, window.innerHeight)
  
    let m
    if(render_mode == 'point_cloud') {
      m = set_point_cloud(points, colors, sizes)
    } else {
      m = await set_surface(image, points)
    }
    let z = (corner_max.z + corner_min.z) / 2
    m.position.set(0, 0, z)
    model = new THREE.Group()
    model.add(m)
    model.position.set(0, 0, 50 - z)
  
    scene.add(model);
  
    camera.position.set(0, 0, 50)
  }

  createWorld()

  window.addEventListener('mousemove', (e)=>{
    if(!model) {
      return
    }

    // compute x and w with respect to window
    let x = e.clientX
    let y = e.clientY

    x = x / window.innerWidth - 0.5
    y = - (y / window.innerHeight - 0.5)

    model.rotation.x = 0.1 * sensitivity * y * Math.PI
    model.rotation.y = -0.1 * sensitivity * x * Math.PI
  })
  window.addEventListener('resize', ()=> {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
  }, false)

  function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
  }

  animate();
}
