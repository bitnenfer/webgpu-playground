const webgpu = {
    adapter: null,
    device: null
};
const renderer = {
    canvas: null,
    gpuCanvasContext: null,
    swapChain: null,
    swapChainTextureFormat: null,
    vertShaderBinData: null,
    fragShaderBinData: null,
    uniformBuffer: null,
    vertexBuffer: null,
    vertShader: null,
    fragShader: null,
    bindGroupLayout: null,
    bindGroup: null,
    pipelineLayout: null,
    renderPipeline: null,
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

function loadResources () 
{
    loadBinFiles(["shaders/basic/basic.vert.bin", "shaders/basic/basic.frag.bin"]).
        then((loadedShaders) => {
            renderer.vertShaderBinData = loadedShaders["shaders/basic/basic.vert.bin"];
            renderer.fragShaderBinData = loadedShaders["shaders/basic/basic.frag.bin"];
            initRenderer();
        }).
        catch(error => console.error("Failed to load shader files", error));
}

function initRenderer () 
{
    const device = webgpu.device;

    // Create Vertex Buffer
    {
        const vertices = new Float32Array([
            +0.0, +1.0, +0.0,
            +1.0, -1.0, +0.0,
            -1.0, -1.0, +0.0
        ]);
        const mappedVertexBuffer = device.createBufferMapped({
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX
        });
        renderer.vertexBuffer = mappedVertexBuffer[0];
        new Float32Array(mappedVertexBuffer[1]).set(vertices);
        renderer.vertexBuffer.unmap();
    }

    // Create Pipeline Layout
    {
        // Uniform Buffer
        const identityMatrix = new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ]);

        const mappedUniformBuffer = device.createBufferMapped({
            size: identityMatrix.byteLength,
            usage: GPUBufferUsage.UNIFORM
        });
        renderer.uniformBuffer = mappedUniformBuffer[0];
        new Float32Array(mappedUniformBuffer[1]).set(identityMatrix);
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
                        size: identityMatrix.byteLength
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
                cullMode: "none", 
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
            /*depthStencilState: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus-stencil8",
            },*/
            vertexState: {
                vertexBuffers: [
                    {
                        arrayStride: Float32Array.BYTES_PER_ELEMENT * 3,
                        stepMode: "vertex",
                        attributes: [
                            {
                                format: "float3",
                                offset: 0,
                                shaderLocation: 0
                            }
                        ]
                    }
                ]
            }
        });

        renderer.renderPipeline = renderPipeline;
    }

    renderScene();
}

function renderScene (time)
{   
    const device = webgpu.device;
    const commandEncoder = device.createCommandEncoder({});
    const mainRenderTargetView = renderer.swapChain.getCurrentTexture().createView();
    const renderCommandEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
            {
                attachment: mainRenderTargetView,
                loadValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                storeOp: "store"
            }
        ]
    });

    renderCommandEncoder.setPipeline(renderer.renderPipeline);
    renderCommandEncoder.setVertexBuffer(0, renderer.vertexBuffer, 0);
    renderCommandEncoder.setBindGroup(0, renderer.bindGroup);
    renderCommandEncoder.draw(3, 1, 0, 0);
    renderCommandEncoder.endPass();

    const commandBuffer = commandEncoder.finish({});

    webgpu.device.defaultQueue.submit([commandBuffer]);

    requestAnimationFrame(renderScene);
}

window.onload = () => {
    initWebGPU();
};