import { RefObject, useCallback, useState, useLayoutEffect } from 'react';

interface Position {
  position: number;
  content: string;
  line: number;
}

type History = [Position, string];
type ChangeHandler = (text: string, position: Position) => void;
type UpdateAction = (content: string) => void;

const observerSettings = {
  characterData: true,
  characterDataOldValue: true,
  childList: true,
  subtree: true,
};

const isUndoRedoKey = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && event.code === 'KeyZ';

const toString = (element: HTMLElement): string => {
  const queue: Node[] = [element.firstChild!];

  let content = '';
  let node: Node;
  while ((node = queue.pop()!)) {
    if (node.nodeType === Node.TEXT_NODE) {
      content += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') {
      content += '\n';
    }

    if (node.nextSibling) queue.push(node.nextSibling);
    if (node.firstChild) queue.push(node.firstChild);
  }

  // contenteditable Quirk: Without plaintext-only a pre/pre-wrap element must always
  // end with at least one newline character
  if (content[content.length - 1] !== '\n') content += '\n';

  return content;
};

const getPosition = (element: HTMLElement): Position => {
  const selection = window.getSelection()!;
  const queue: Node[] = [element.firstChild!];

  // Without plaintext-only mode we may get a node and an offset of one of its children
  // if the selection happens to land in-between nodes
  let { focusNode, focusOffset } = selection;
  if (focusNode && focusNode.nodeType !== Node.TEXT_NODE) {
    if (focusOffset <= focusNode.childNodes.length - 1)
      focusNode = focusNode.childNodes[focusOffset];
    focusOffset = 0;
  }

  let position = 0;
  let line = 0;
  let content = '';
  let node: Node | void;
  while ((node = queue.pop()!)) {
    if (node.nodeType === Node.TEXT_NODE) {
      let textContent = node.textContent!;
      if (node === focusNode) {
        textContent = textContent.slice(0, focusOffset);
      }

      position += textContent.length;
      content += textContent;
      const newlineRe = /\n/g;

      let match: RegExpExecArray | null;
      while ((match = newlineRe.exec(textContent))) {
        content = textContent.slice(match.index + 1);
        line++;
      }

      if (node === focusNode) break;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') {
      content = '';
      line++;
      position++;
    }

    if (node.nextSibling && node !== focusNode) queue.push(node.nextSibling);
    if (node.firstChild) queue.push(node.firstChild);
  }

  return {
    position,
    content,
    line,
  };
};

const setPosition = (element: HTMLElement, position: number): void => {
  const selection = window.getSelection()!;
  const range = document.createRange();
  const queue: Node[] = [element.firstChild!];
  let current = 0;

  let node: Node;
  while ((node = queue.pop()!)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent!.length;
      if (current + length >= position) {
        const offset = position - current;
        if (offset === length) {
          range.setStartAfter(node);
        } else {
          range.setStart(node, offset);
        }
        break;
      }

      current += node.textContent!.length;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') {
      if (current + 1 >= position) {
        range.setStartAfter(node);
        break;
      }

      current++;
    }

    if (node.nextSibling) queue.push(node.nextSibling);
    if (node.firstChild) queue.push(node.firstChild);
  }

  selection.empty();
  selection.addRange(range);
};

const insert = (text: string) => {
  const selection = window.getSelection()!;
  let range = window.getSelection()!.getRangeAt(0)!;
  const node = document.createTextNode(text);
  selection.getRangeAt(0).deleteContents();
  range.insertNode(node);
  range = document.createRange();
  range.setStartAfter(node);
  selection.empty();
  selection.addRange(range);
};

interface Options {
  disabled?: boolean;
  indentation?: number;
}

type State = [
  observer: MutationObserver,
  disconnected: boolean,
  onChange: ChangeHandler,
  queue: MutationRecord[],
  history: History[],
  historyAt: number,
  position: number
];

export const useEditable = (
  elementRef: RefObject<HTMLElement>,
  onChange: ChangeHandler,
  opts?: Options
): UpdateAction => {
  if (!opts) opts = {};

  const unblock = useState([])[1];
  const state: State = useState(() => {
    const state: State = [
      null as any /* observer */,
      false /* disconnected */,
      onChange /* onChange */,
      [] /* queue */,
      [] /* history */,
      -1 /* historyAt */,
      -1 /* position */,
    ] as any;

    if (typeof MutationObserver !== 'undefined') {
      state[0 /* observer */] = new MutationObserver(batch => {
        state[3 /* queue */].push(...batch);
      });
    }

    return state;
  })[0];

  const update = useCallback((content: string) => {
    const { current: element } = elementRef;
    if (element) {
      const position = getPosition(element);
      const prevContent = toString(element);
      state[6 /* position */] =
        position.position + (content.length - prevContent.length);
      state[2 /* onChange */](content, position);
    }
  }, []);

  // Only for SSR / server-side logic
  if (typeof navigator !== 'object') return update;

  useLayoutEffect(() => {
    state[2 /* onChange */] = onChange;

    if (!elementRef.current || opts!.disabled) return;

    state[1 /* disconnected */] = false;
    state[0 /* observer */].observe(elementRef.current, observerSettings);
    if (state[6 /* position */] >= 0) {
      setPosition(elementRef.current, state[6 /* position */]);
    }

    return () => {
      state[0 /* observer */].disconnect();
    };
  });

  useLayoutEffect(() => {
    if (!elementRef.current || opts!.disabled) {
      state[4 /* history */].length = 0;
      state[5 /* historyAt */] = -1;
      return;
    }

    const element = elementRef.current!;
    if (state[6 /* position */] > -1) {
      element.focus();
      setPosition(element, state[6 /* position */]);
    }

    const prevWhiteSpace = element.style.whiteSpace;
    const prevContentEditable = element.contentEditable;
    let hasPlaintextSupport = true;
    try {
      // Firefox and IE11 do not support plaintext-only mode
      element.contentEditable = 'plaintext-only';
    } catch (_error) {
      element.contentEditable = 'true';
      hasPlaintextSupport = false;
    }

    if (prevWhiteSpace !== 'pre') element.style.whiteSpace = 'pre-wrap';

    if (opts!.indentation) {
      element.style.tabSize = (element.style as any).MozTabSize =
        '' + opts!.indentation;
    }

    const indentRe = new RegExp(
      `^(?:${' '.repeat(opts!.indentation || 0)}|\\t)`
    );

    let _trackStateTimestamp: number;
    const trackState = (ignoreTimestamp?: boolean) => {
      if (!elementRef.current || state[6 /* position */] === -1) return;

      const history = state[4 /* history */];
      const content = toString(element);
      const position = getPosition(element);
      const timestamp = new Date().valueOf();

      // Prevent recording new state in list if last one has been new enough
      const lastEntry = history[state[5 /* historyAt */]];
      if (
        (!ignoreTimestamp && timestamp - _trackStateTimestamp < 500) ||
        (lastEntry && lastEntry[1] === content)
      ) {
        _trackStateTimestamp = timestamp;
        return;
      }

      const at = ++state[5 /* historyAt */];
      history[at] = [position, content];
      history.splice(at + 1);
      if (at > 500) {
        state[5 /* historyAt */]--;
        history.shift();
      }
    };

    const disconnect = () => {
      state[0 /* observer */].disconnect();
      state[1 /* disconnected */] = true;
    };

    const flushChanges = () => {
      state[3 /* queue */].push(...state[0 /* observer */].takeRecords());
      if (state[3 /* queue */].length) {
        disconnect();
        const content = toString(element);
        const position = getPosition(element);
        state[6 /* position */] = position.position;
        let mutation: MutationRecord | void;
        let i = 0;
        while ((mutation = state[3 /* queue */].pop())) {
          if (mutation.oldValue !== null)
            mutation.target.textContent = mutation.oldValue;
          for (i = mutation.removedNodes.length - 1; i >= 0; i--)
            mutation.target.insertBefore(
              mutation.removedNodes[i],
              mutation.nextSibling
            );
          for (i = mutation.addedNodes.length - 1; i >= 0; i--)
            if (mutation.addedNodes[i].parentNode)
              mutation.target.removeChild(mutation.addedNodes[i]);
        }

        state[2 /* onChange */](content, position);
      }
    };

    const onKeyDown = (event: HTMLElementEventMap['keydown']) => {
      if (event.defaultPrevented || event.target !== element) {
        return;
      } else if (state[1 /* disconnected */]) {
        // React Quirk: It's expected that we may lose events while disconnected, which is why
        // we'd like to block some inputs if they're unusually fast. However, this always
        // coincides with React not executing the update immediately and then getting stuck,
        // which can be prevented by issuing a dummy state change.
        event.preventDefault();
        return unblock([]);
      }

      if (isUndoRedoKey(event)) {
        event.preventDefault();

        let history: History;
        if (!event.shiftKey) {
          const at = --state[5 /* historyAt */];
          history = state[4 /* history */][at];
          if (!history) state[5 /* historyAt */] = 0;
        } else {
          const at = ++state[5 /* historyAt */];
          history = state[4 /* history */][at];
          if (!history)
            state[5 /* historyAt */] = state[4 /* history */].length - 1;
        }

        if (history) {
          disconnect();
          state[6 /* position */] = history[0].position;
          state[2 /* onChange */](history[1], history[0]);
        }
        return;
      } else {
        trackState();
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        // Firefox / IE11 Quirk: Since plaintext-only is unsupported we must
        // ensure that only newline characters are inserted
        const position = getPosition(element);
        // We also get the current line and preserve indentation for the next
        // line that's created
        const match = /\S/g.exec(position.content);
        const index = match ? match.index : position.content.length;
        const text = '\n' + position.content.slice(0, index);
        insert(text);
      } else if (!hasPlaintextSupport && event.key === 'Backspace') {
        event.preventDefault();
        const range = window.getSelection()!.getRangeAt(0)!;
        if (
          range.startContainer !== range.endContainer ||
          range.startOffset !== range.endOffset
        ) {
          range.deleteContents();
        } else {
          // Firefox Quirk: Backspacing won't preserve the correct position
          // so it's easier to reimplement it and skip rendering for normal backspacing
          disconnect();
          const position = getPosition(element);
          const index = Math.max(0, position.position - 1);
          const content = toString(element);
          update(content.slice(0, index) + content.slice(index + 1));
        }
      } else if (opts!.indentation && event.key === 'Tab') {
        event.preventDefault();
        const position = getPosition(element);
        const start = position.position - position.content.length;
        const content = toString(element);
        const newContent = event.shiftKey
          ? content.slice(0, start) +
            position.content.replace(indentRe, '') +
            content.slice(start + position.content.length)
          : content.slice(0, start) + '\t' + content.slice(start);
        update(newContent);
      }
    };

    const onKeyUp = (event: HTMLElementEventMap['keyup']) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!isUndoRedoKey(event)) trackState();
      flushChanges();
      // Chrome Quirk: The contenteditable may lose focus after the first edit or so
      element.focus();
    };

    const onFocus = () => {
      state[6 /* position */] = getPosition(element).position;
    };

    const onBlur = () => {
      state[6 /* position */] = -1;
    };

    const onPaste = (event: HTMLElementEventMap['paste']) => {
      event.preventDefault();
      trackState(true);
      insert(event.clipboardData!.getData('text/plain'));
      trackState(true);
      flushChanges();
    };

    window.addEventListener('keydown', onKeyDown);
    element.addEventListener('focus', onFocus);
    element.addEventListener('blur', onBlur);
    element.addEventListener('paste', onPaste);
    element.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('focus', onFocus);
      element.removeEventListener('blur', onBlur);
      element.removeEventListener('paste', onPaste);
      element.removeEventListener('keyup', onKeyUp);
      element.style.whiteSpace = prevWhiteSpace;
      element.contentEditable = prevContentEditable;
    };
  }, [elementRef.current!, opts!.disabled, opts!.indentation]);

  return update;
};
