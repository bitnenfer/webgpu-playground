(function (scope) {
    const nameOfFile = location.hash.substr(1, location.hash.length - 1);
    const meshToLoad = "data/meshes/" + (nameOfFile.length > 0 ? nameOfFile : "torus") + ".obj";
    const mat2 = glMatrix.mat2;
    const mat2d = glMatrix.mat2d;
    const mat3 = glMatrix.mat3;
    const mat4 = glMatrix.mat4;
    const quat = glMatrix.quat;
    const quat2 = glMatrix.quat2;
    const vec2 = glMatrix.vec2;
    const vec3 = glMatrix.vec3;
    const vec4 = glMatrix.vec4;
    const webgpu = {
        adapter: null,
        device: null
    };
    const meshes = {
        monkey: null
    };
    const renderer = {
        model: mat4.create(),
        view: mat4.create(),
        projection: mat4.create(),
        invModelView: mat4.create(),
        uniformData: new Float32Array(16 * 4),
        canvas: null,
        gpuCanvasContext: null,
        swapChain: null,
        swapChainTextureFormat: null,
        vertShaderBinData: null,
        fragShaderBinData: null,
        uniformBuffer: null,
        uniformCopyBuffer: null,
        vertShader: null,
        fragShader: null,
        bindGroupLayout: null,
        bindGroup: null,
        pipelineLayout: null,
        renderPipeline: null,
        depthStencilTexture: null
    };

    function loadBinFiles (paths)
    {
        return new Promise((success, fail) => {
            const loadedData = {};
            let loadedCount = 0;
            for (let i = 0; i < paths.length; ++i)
            {
                const path = paths[i];
                const xhr = new XMLHttpRequest();
                xhr.onload = (function (_xhr, _path) {
                    return function (evt) {
                        if (_xhr.status === 200 && _xhr.readyState === 4) {
                            loadedData[_path] = _xhr.response;
                            if (++loadedCount >= paths.length)
                                success(loadedData);
                        }
                    }
                }(xhr, path));
                xhr.onerror = error => fail(error);
                xhr.responseType = "arraybuffer"
                xhr.open("GET", path);
                xhr.send(null);
            }
        });
    }

    function loadTextFiles (paths)
    {
        return new Promise((success, fail) => {
            const loadedData = {};
            let loadedCount = 0;
            for (let i = 0; i < paths.length; ++i)
            {
                const path = paths[i];
                const xhr = new XMLHttpRequest();
                xhr.onload = (function (_xhr, _path) {
                    return function (evt) {
                        if (_xhr.status === 200 && _xhr.readyState === 4) {
                            loadedData[_path] = _xhr.responseText;
                            if (++loadedCount >= paths.length)
                                success(loadedData);
                        }
                    }
                }(xhr, path));
                xhr.onerror = error => fail(error);
                xhr.open("GET", path);
                xhr.send(null);
            }
        });
    }

    function initWebGPU ()
    {
        navigator.gpu.requestAdapter({ powerPreference: "high-performance" }).then(adapter => {
            webgpu.adapter = adapter;
            adapter.requestDevice().then(device => {
                webgpu.device = device;
                renderer.canvas = document.getElementById("canvas");
                renderer.gpuCanvasContext = renderer.canvas.getContext("gpupresent");
                renderer.gpuCanvasContext.getSwapChainPreferredFormat(device).
                    then(format => {
                        renderer.swapChain = renderer.gpuCanvasContext.configureSwapChain({
                            device: device,
                            format: format,
                            usage: GPUTextureUsage.OUTPUT_ATTACHMENT
                        });
                        renderer.swapChainTextureFormat = format;
                        loadResources();
                    });
            }).catch(error => {
                console.log("Failed to request GPU device.\n", error);
            });
        }).catch(error => {
            console.error("Failed to request GPU adapter.\n", error);
        });
    }

    function initMesh (device, meshData)
    {
        const objParsedData = objpar_to_mesh(objpar(meshData));
        const mappedVertexBuffer = device.createBufferMapped({
            size: objParsedData.vertices.byteLength,
            usage: GPUBufferUsage.VERTEX
        });
        new Float32Array(mappedVertexBuffer[1]).set(objParsedData.vertices);
        mappedVertexBuffer[0].unmap();
        return {
            vertexBuffer: mappedVertexBuffer[0],
            vertexCount: objParsedData.vertex_count
        };
    }

    function loadResources () 
    {
        loadTextFiles([meshToLoad]).
            then(loadedMeshes => {

                meshes.monkey = initMesh(webgpu.device, loadedMeshes[meshToLoad]);

                loadBinFiles(["shaders/basic/basic.vert.bin", "shaders/basic/basic.frag.bin"]).
                    then((loadedShaders) => {
                        renderer.vertShaderBinData = loadedShaders["shaders/basic/basic.vert.bin"];
                        renderer.fragShaderBinData = loadedShaders["shaders/basic/basic.frag.bin"];

                        mat4.perspective(renderer.projection, 40 * Math.PI / 180, renderer.canvas.width / renderer.canvas.height, 0.1, 1000.0); 
                        mat4.translate(renderer.view, renderer.view, [0, 0, -10]);

                        initGPUResources();
                    }).
                    catch(error => console.error("Failed to load shader files", error));

            }).
            catch(error => {
                alert("Cant load files");
            });
    }

    function initGPUResources () 
    {
        const device = webgpu.device;
        // Create Depth-Stencil Target
        {
            renderer.depthStencilTexture = device.createTexture({
                size: {
                    width: renderer.canvas.width,
                    height: renderer.canvas.height,
                    depth: 1
                },
                arrayLayerCount: 1,
                mipLevelCount: 1,
                sampleCount: 1,
                dimension: "2d",
                format: "depth24plus-stencil8",
                usage: GPUTextureUsage.OUTPUT_ATTACHMENT
            });
        }

        // Create Pipeline Layout
        {
            // Uniform Buffer
            const mappedUniformBuffer = device.createBufferMapped({
                size: renderer.uniformData.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            const mappedUniformCopyBuffer = device.createBufferMapped({
                size: renderer.uniformData.byteLength,
                usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC
            });
            renderer.uniformBuffer = mappedUniformBuffer[0];
            renderer.uniformCopyBuffer = mappedUniformCopyBuffer[0];
            renderer.uniformData.set(renderer.model, 0);
            renderer.uniformData.set(renderer.view, 16);
            renderer.uniformData.set(renderer.projection, 32);
            renderer.uniformData.set(renderer.invModelView, 48);

            new Float32Array(mappedUniformCopyBuffer[1]).set(renderer.uniformData);
            new Float32Array(mappedUniformBuffer[1]).set(renderer.uniformData);

            renderer.uniformCopyBuffer.unmap();
            renderer.uniformBuffer.unmap();

            renderer.bindGroupLayout = device.createBindGroupLayout({
                bindings: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.VERTEX,
                        type: "uniform-buffer",
                        textureDimension: "2d",
                        textureComponentType: "float",
                        multisampled: false,
                        hasDynamicOffset: false
                    }
                ]
            });

            renderer.bindGroup = device.createBindGroup({
                layout: renderer.bindGroupLayout,
                bindings: [
                    {
                        binding: 0,
                        resource: {
                            buffer: renderer.uniformBuffer,
                            offset: 0,
                            size: renderer.model.byteLength
                        }
                    }
                ]
            });

            renderer.pipelineLayout = device.createPipelineLayout({
                bindGroupLayouts: [ renderer.bindGroupLayout ]
            });
        }

        // Create Render Pipeline
        {
            const vertShaderModule = device.createShaderModule({ code: new Uint32Array(renderer.vertShaderBinData) });
            const fragShaderModule = device.createShaderModule({ code: new Uint32Array(renderer.fragShaderBinData) });
            const renderPipeline = device.createRenderPipeline({
                layout: renderer.pipelineLayout,
                vertexStage: { entryPoint: "main", module: vertShaderModule },
                fragmentStage: { entryPoint: "main", module: fragShaderModule },
                primitiveTopology: "triangle-list",
                sampleCount: 1,
                sampleMask: 0xFFFFFFFF,
                alphaToCoverageEnabled: false,
                rasterizationState: { 
                    frontFace: "ccw", 
                    cullMode: "back", 
                    depthBias: 0, 
                    depthBiasSlopeScale: 0, 
                    depthBiasClamp: 0 
                },
                colorStates: [
                    { 
                        format: renderer.swapChainTextureFormat,
                        alphaBlend: {
                            srcFactor: "one",
                            dstFactor: "zero",
                            operation: "add"
                        },
                        colorBlend: {
                            srcFactor: "one",
                            dstFactor: "zero",
                            operation: "add"
                        },
                        writeMask: GPUColorWrite.ALL
                    }
                ],
                depthStencilState: {
                    format: "depth24plus-stencil8",
                    depthWriteEnabled: true,
                    depthCompare: "less",
                    stencilFront: {
                        compare: "always",
                        failOp: "keep",
                        depthFailOp: "keep",
                        passOp: "keep"
                    },
                    stencilBack: {
                        compare: "always",
                        failOp: "keep",
                        depthFailOp: "keep",
                        passOp: "keep"
                    },
                    stencilReadMask: 0xFFFFFFFF,
                    stencilWriteMask: 0xFFFFFFFF
                },
                vertexState: {
                    vertexBuffers: [
                        {
                            arrayStride: Float32Array.BYTES_PER_ELEMENT * 3 + Float32Array.BYTES_PER_ELEMENT * 3 + Float32Array.BYTES_PER_ELEMENT * 2,
                            stepMode: "vertex",
                            attributes: [
                                {
                                    format: "float3",
                                    offset: 0,
                                    shaderLocation: 0
                                },
                                {
                                    format: "float3",
                                    offset: Float32Array.BYTES_PER_ELEMENT * 3,
                                    shaderLocation: 1
                                },
                                {
                                    format: "float2",
                                    offset: Float32Array.BYTES_PER_ELEMENT * 3 + Float32Array.BYTES_PER_ELEMENT * 3,
                                    shaderLocation: 2
                                }
                            ]
                        }
                    ]
                }
            });

            renderer.renderPipeline = renderPipeline;
        }

        frame();
    }

    function frame (time)
    {   
        // Update
        {
            mat4.rotateX(renderer.model, renderer.model, 0.01);
            mat4.rotateY(renderer.model, renderer.model, 0.01);
            mat4.rotateZ(renderer.model, renderer.model, 0.01);
            mat4.multiply(renderer.invModelView, renderer.view, renderer.model);
            mat4.transpose(renderer.invModelView, renderer.invModelView);
            mat4.invert(renderer.invModelView, renderer.invModelView);
            renderer.uniformData.set(renderer.model, 0);
            renderer.uniformData.set(renderer.view, 16);
            renderer.uniformData.set(renderer.projection, 32);
            renderer.uniformData.set(renderer.invModelView, 48);
        }
        
        // Render
        {
            renderer.uniformCopyBuffer.unmap();

            const device = webgpu.device;
            const mainRenderTargetView = renderer.swapChain.getCurrentTexture().createView();
            const mainDepthStencilView = renderer.depthStencilTexture.createView();
            const commandEncoder = device.createCommandEncoder({});
            
            commandEncoder.copyBufferToBuffer(renderer.uniformCopyBuffer, 0, renderer.uniformBuffer, 0, renderer.uniformData.byteLength);
            
            const renderCommandEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [
                    {
                        attachment: mainRenderTargetView,
                        loadValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                        storeOp: "store"
                    }
                ],
                depthStencilAttachment: {
                    attachment: mainDepthStencilView,
                    depthLoadValue: 1,
                    depthStoreOp: "store",
                    stencilLoadValue: 0,
                    stencilStoreOp: "store"
                }
            });

            renderCommandEncoder.setPipeline(renderer.renderPipeline);
            renderCommandEncoder.setVertexBuffer(0, meshes.monkey.vertexBuffer, 0);
            renderCommandEncoder.setBindGroup(0, renderer.bindGroup);
            renderCommandEncoder.draw(meshes.monkey.vertexCount, 1, 0, 0);
            renderCommandEncoder.endPass();

            const commandBuffer = commandEncoder.finish({});

            webgpu.device.defaultQueue.submit([commandBuffer]);

            renderer.uniformCopyBuffer.mapWriteAsync().
                then(arrayBuffer => {
                    const uniformBufferData = new Float32Array(arrayBuffer);
                    uniformBufferData.set(renderer.uniformData, 0);
                }).
                catch(error => {
                    // console.error("Failed to map buffer", error);
                });
        }

        requestAnimationFrame(frame);
    }

    window.onload = () => {
        initWebGPU();
    };

    const meshSelectionElement = document.getElementById("mesh-list");
    for (let i = 0; i < meshSelectionElement.options.length; ++i)
    {
        if (nameOfFile === meshSelectionElement.options[i].value)
        {
            meshSelectionElement.selectedIndex = i;
            break;
        }
    }
    meshSelectionElement.onchange = evt => {
        location.hash = "#" + evt.target.options[evt.target.selectedIndex].value;
        location.reload();
    };

    scope.renderer = renderer;
}(window));

