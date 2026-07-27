{
  "targets": [
    {
      "target_name": "capture_addon",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "sources": [
        "src/capture_addon.cc",
        "src/capture_bridge.mm"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "MACOSX_DEPLOYMENT_TARGET": "10.15"
            },
            "libraries": [
              "-framework AVFoundation",
              "-framework Metal",
              "-framework MetalKit",
              "-framework CoreVideo",
              "-framework CoreMedia",
              "-framework AppKit",
              "-framework QuartzCore",
              "-framework Foundation"
            ],
            "sources": [
              "src/capture_addon.cc",
              "src/capture_bridge.mm"
            ]
          }
        ],
        [
          "OS!='mac'",
          {
            "type": "none"
          }
        ]
      ]
    }
  ]
}
