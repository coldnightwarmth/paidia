#!/usr/bin/env swift

import AppKit
import Foundation
import Vision

func recognize(_ path: String) throws -> [String] {
    guard let image = NSImage(contentsOfFile: path),
          let data = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: data),
          let cgImage = bitmap.cgImage else {
        throw NSError(domain: "ShortformOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not read \(path)"])
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])

    let observations = (request.results ?? []).sorted { left, right in
        let verticalDifference = left.boundingBox.midY - right.boundingBox.midY
        if abs(verticalDifference) > 0.008 { return verticalDifference > 0 }
        return left.boundingBox.minX < right.boundingBox.minX
    }
    return observations.compactMap { $0.topCandidates(1).first?.string }
}

for path in CommandLine.arguments.dropFirst() {
    print("===PAGE===\t\(path)")
    do {
        for line in try recognize(path) { print(line) }
    } catch {
        fputs("OCR error for \(path): \(error)\n", stderr)
    }
}
