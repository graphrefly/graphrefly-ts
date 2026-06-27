# reactive-layout / recipes

These recipes show user-land measurement glue. They do not add public React Native hooks,
components, generic fallback policy, or runtime ownership to GraphReFly. Host runtimes write facts
into graph state; reactive-layout consumes a caller-composed `measurements` node.

## React Native onLayout/native probe facts

React Native layout is asynchronous. Treat `onLayout` or a native probe as the host event that
updates graph state, then project that state into measurement facts with
`reactNativeLayoutMeasurements`.

```tsx
import type { ReactNode } from "react";
import { View } from "react-native";
import { graph } from "@graphrefly/ts";
import { mergeMeasurements } from "@graphrefly/ts/solutions/reactive-layout";
import {
  reactNativeLayoutMeasurements,
  type ReactNativeLayoutProbe,
} from "@graphrefly/ts/solutions/reactive-layout/react-native";

const g = graph({ name: "rn-layout-recipe" });
const layoutProbes = g.state<readonly ReactNativeLayoutProbe[]>([], {
  name: "rn-layout-probes",
});

function recordLayout(id: string, width: number, height: number) {
  const previous = layoutProbes.cache ?? [];
  layoutProbes.set([
    ...previous.filter((probe) => probe.id !== id),
    { id, width, height, source: "onLayout" },
  ]);
}

function recordNativePending(id: string) {
  const previous = layoutProbes.cache ?? [];
  layoutProbes.set([
    ...previous.filter((probe) => probe.id !== id),
    { id, ready: false, code: "layout.pending", source: "native-probe" },
  ]);
}

function MeasuredCard({ id, children }: { id: string; children: ReactNode }) {
  return (
    <View
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        recordLayout(id, width, height);
      }}
    >
      {children}
    </View>
  );
}

const rnLayoutFacts = reactNativeLayoutMeasurements({
  graph: g,
  probes: layoutProbes,
  name: "rn-layout-measurements",
});

const measurements = mergeMeasurements({
  graph: g,
  sources: [rnLayoutFacts],
  name: "measurements",
});
```

The local `MeasuredCard` is application glue, not a GraphReFly export. Invalid, pending, or missing
native measurements become `DataIssue` facts; they are not protocol `ERROR`s and do not make RN
measurement look synchronous.

## Skia fonts/readiness facts

Skia text measurement is synchronous only after the caller has a ready Skia runtime and font manager.
Keep `useFonts` readiness explicit, then pass a ready capability to
`skiaReadyTextMeasurements`.

```tsx
import { useEffect } from "react";
import { Skia, useFonts } from "@shopify/react-native-skia";
import { graph } from "@graphrefly/ts";
import {
  mergeMeasurements,
  type MeasurementReadiness,
} from "@graphrefly/ts/solutions/reactive-layout";
import {
  skiaParagraphTextMeasureCapability,
  skiaReadyTextMeasurements,
} from "@graphrefly/ts/solutions/reactive-layout/skia";

const g = graph({ name: "skia-layout-recipe" });
const text = g.state("Measure me with Skia Paragraph.", { name: "text" });
const font = g.state("Inter", { name: "font" });
const readiness = g.state<MeasurementReadiness>(
  { ready: false, code: "font.loading", source: "useFonts" },
  { name: "skia-font-ready" },
);

function SkiaLayoutOwner() {
  const fontManager = useFonts({
    Inter: [require("./Inter-Regular.ttf")],
  });

  useEffect(() => {
    if (!fontManager) {
      readiness.set({ ready: false, code: "font.loading", source: "useFonts" });
      return;
    }
    skiaCapability.set(
      skiaParagraphTextMeasureCapability({
        Skia,
        fontManager,
        textStyleForFont: (family) => ({ fontFamilies: [family], fontSize: 16 }),
      }),
    );
    readiness.set({ ready: true, source: "useFonts" });
  }, [fontManager]);

  return null;
}

const skiaCapability = g.state(
  skiaParagraphTextMeasureCapability({
    Skia,
    textStyleForFont: (family) => ({ fontFamilies: [family], fontSize: 16 }),
  }),
  { name: "skia-capability" },
);

const skiaTextFacts = skiaReadyTextMeasurements({
  graph: g,
  text,
  font,
  capability: skiaCapability,
  readiness,
  name: "skia-text-measurements",
});

const measurements = mergeMeasurements({
  graph: g,
  sources: [skiaTextFacts],
  name: "measurements",
});
```

The `useFonts` result is deliberately not hidden inside the provider. While fonts are loading, the
graph carries a readiness issue. When the caller marks readiness true and writes the ready
capability, Skia text facts become ordinary measurement DATA.

## Provider composition for layout

Compose text, readiness, image, and SVG provider facts upstream. `mergeMeasurements` preserves the
source order you pass; it is not a fallback, dedupe, stale, or priority policy engine.

```ts
import { graph } from "@graphrefly/ts";
import {
  ImageSizeAdapter,
  SvgBoundsAdapter,
  cellTextMeasurements,
  imageSizeMeasurements,
  mergeMeasurements,
  reactiveLayout,
  readinessMeasurements,
  svgBoundsMeasurements,
  type MeasurementReadiness,
} from "@graphrefly/ts/solutions/reactive-layout";

const g = graph({ name: "provider-composition-recipe" });
const text = g.state("Graph-visible provider facts.", { name: "text" });
const font = g.state("14px Inter", { name: "font" });
const fontReady = g.state<MeasurementReadiness>(
  { ready: true, source: "font-face-set" },
  { name: "font-ready" },
);

const textFacts = cellTextMeasurements({
  graph: g,
  text,
  font,
  cellWidth: 7,
  targetId: "copy",
  name: "copy-text-measurements",
});

const readinessFacts = readinessMeasurements({
  graph: g,
  readiness: fontReady,
  targetId: "font:Inter",
  name: "font-readiness-measurements",
});

const imageFacts = imageSizeMeasurements({
  graph: g,
  images: g.state([{ id: "hero", src: "hero.png" }], { name: "images" }),
  measurer: g.state(new ImageSizeAdapter({ "hero.png": { width: 1280, height: 720 } }), {
    name: "image-size-capability",
  }),
  name: "image-size-measurements",
});

const svgFacts = svgBoundsMeasurements({
  graph: g,
  svgs: g.state([{ id: "logo", svg: '<svg width="120" height="32"></svg>' }], {
    name: "svgs",
  }),
  measurer: g.state(new SvgBoundsAdapter(), { name: "svg-bounds-capability" }),
  name: "svg-bounds-measurements",
});

const measurements = mergeMeasurements({
  graph: g,
  sources: [readinessFacts, textFacts, imageFacts, svgFacts],
  name: "measurements",
});

const layout = reactiveLayout({
  graph: g,
  measurements,
  targetId: "copy",
  maxWidth: 360,
  lineHeight: 20,
});
```

Layout reads the text facts for `targetId: "copy"`. Readiness, image, and SVG facts stay visible for
downstream projections or issue UI, but layout does not own provider precedence or missing-fact
policy.
