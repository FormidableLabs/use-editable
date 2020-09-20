<div align="center">
  <h2 align="center">use-editable</h2>
  <p align="center"><strong>A small React hook to turn elements into fully renderable & editable content surfaces, like code editors, using contenteditable (and magic)</strong></p>
  <br />
  <a href="https://npmjs.com/package/use-editable">
    <img alt="NPM Version" src="https://img.shields.io/npm/v/use-editable.svg" />
  </a>
  <a href="https://npmjs.com/package/use-editable">
    <img alt="License" src="https://img.shields.io/npm/l/use-editable.svg" />
  </a>
  <a href="https://bundlephobia.com/result?p=use-editable">
    <img alt="Minified gzip size" src="https://img.shields.io/bundlephobia/minzip/use-editable.svg?label=gzip%20size" />
  </a>
  <br />
  <br />
</div>

`useEditable` is a small hook that enables elements to be `contenteditable` while still being fully renderable.
This is ideal for creating small code editors or prose textareas in under `2kB`!

It aims to allow any element to be editable while still being able to render normal React elements to it — no `innerHTML` and having to deal with operating with or rendering to raw HTML, or starting a full editor project from scratch.

> ⚠️ **Experimental**
> The `useEditable` hook is a proof-of-concept stage project and its API isn't finalised yet.
> It aims to support content that doesn't quite map 1:1 to DOM content and further event handlers
> to handle inputs more granularly.

## Usage

First install `use-editable` alongside `react`:

```sh
yarn add use-editable
# or
npm install --save use-editable
```

You'll then be able to import `useEditable` and pass it an `HTMLElement` ref and an `onChange` handler.

```js
import React, { useState, useRef } from 'react';
import { useEditable } from 'use-editable';

const RainbowCode = () => {
  const [code, setCode] = useState('function test() {}\nconsole.log("hello");');
  const editorRef = useRef(null);

  useEditable(editorRef, setCode);

  return (
    <div className="App">
      <pre
        style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}
        ref={editorRef}
      >
        {code.split(/\r?\n/).map((content, i, arr) => (
          <React.Fragment key={i}>
            <span style={{ color: `hsl(${((i % 20) * 17) | 0}, 80%, 50%)` }}>
              {content}
            </span>
            {i < arr.length - 1 ? '\n' : null}
          </React.Fragment>
        ))}
      </pre>
    </div>
  );
};
```

And just like that we've hooked up `useEditable` to our `editorRef`, which points to the `<pre>`
element that is being rendered, and to `setCode` which drives our state containing some code.

## FAQ

### How does it work?

Traditionally, there have been three options when choosing editing surfaces in React. Either one
could go for a large project like ProseMirror / CodeMirror or similar which take control over much
of the editing and rendering events and are hence rather opinionated, or it's possible to just
use `contenteditable` and render to raw HTML that is replaced in the element's content, or lastly one
could combine a `textarea` with an overlapping `div` that renders stylised content.

All three options don't allow much customisation in terms of what actually gets rendered or put
unreasonable restrictions on how easy it is to render and manage an editable's content.

**So what makes rendering to a `contenteditable` element so hard?**

Typically this is tough because they edit the DOM directly. This causes most rendering libraries, like
React and Preact to be confused, since their underlying Virtual DOMs don't match up with the actual
DOM structure anymore. To prevent this issue `use-editable` creates a `MutationObserver`, which watches
over all changes that are made to the `contenteditable` element. Before it reports these changes to
React it first rolls back all changes to the DOM so that React sees what it expects.

Furthermore it also preserves the current position of the caret, the selection, and restores it once
React has updated the DOM itself. This is a rather common technique for `contenteditable` editors, but
the `MutationObserver` addition is what enables `use-editable` to let another view library update the element's
content.

### What's currently possible?

Currently either the rendered elements' text content has to eventually exactly match the code input,
or your implementation must be able to convert the rendered text content back into what you're using
as state. This is a limitation of how `contenteditable`'s work, since they'll only capture the actual
DOM content. Since `use-editable` doesn't aim to be a full component that manages the render cycle, it
doesn't have to keep any extra state, but will only pass the DOM's text back to the `onChange` callback.

### Why is it experimental?

Browsers and their implementation of `contenteditable` are... lacklustre at best, and this has been
a known and often bemoaned issue over the years. While `use-editable` has been tested mainly against
current versions of Chrome, Firefox, and Safari it is Firefox that has most problems with keeping
its selection state consistent — mostly because it doesn't implement `contenteditable="plaintext-only"`
yet.

So be careful when handling newlines; you'll likely want to use newline characters instead of block
or `br` elements for now, until all these edge cases have been tested and fixed in `use-editable`. So for
now this is as mentioned just a (hopefully promising) proof of concept.

## API

### `useEditable`

Currently accepts three arguments:

- An `elementRef` of type `RefObject<HTMLElement>` that contains a ref to an element.
- An `onChange` callback of type `(text: string) => void` which will be called when any change occurs.
- An optional `options` object with settings, which currently only accepts `disabled: boolean` to disable the contenteditable.

## Acknowledgments

- [`react-live`](https://github.com/FormidableLabs/react-live/blob/v1.12.0/src/components/Editor/index.js), which I've worked on
  had one of the early tiny `contenteditable` editors. (But with raw HTML updates)
- [`react-simple-code-editor`](https://github.com/satya164/react-simple-code-editor) was the first (?) library to use a split textarea
  and rendering surface implementation, which presented what a nice editing API should look like.
- [`codejar`](https://github.com/antonmedv/codejar) contains the best tricks to manage selections, although it lacks some
  Firefox workarounds. It also uses raw HTML highlighting / updating.
- [`codemirror.next`](https://github.com/codemirror/codemirror.next) is an invaluable source to see different techniques when
  handling text input and DOM update tricks.
