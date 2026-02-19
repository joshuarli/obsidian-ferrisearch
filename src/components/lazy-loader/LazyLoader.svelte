<div use:load class={rootClass} style="height: {rootInitialHeight}">
  {#if loaded}
    <div
      in:fade={fadeOption || {}}
      class={contentClass}
      style={contentStyle}
    >
      <slot>Lazy load content</slot>
    </div>
    {#if !contentShow && placeholder}
      <Placeholder {placeholder} {placeholderProps} />
    {/if}
  {:else if placeholder}
    <Placeholder {placeholder} {placeholderProps} />
  {/if}
</div>

<script>
  // https://github.com/leafOfTree/svelte-lazy
  import { fade } from 'svelte/transition';
  import Placeholder from './Placeholder.svelte';
  export let keep = false;
  export let height = 0;
  export let offset = 150;
  export let fadeOption = {
    delay: 0,
    duration: 400,
  };
  export let resetHeightDelay = 0;
  export let onload = null;
  export let placeholder = null;
  export let placeholderProps = null;
  let className = '';
  export { className as class };

  const rootClass = 'svelte-lazy'
    + (className ? ' ' + className : '');
  const contentClass = 'svelte-lazy-content';
  const rootInitialHeight = getStyleHeight();
  let loaded = false;

  let contentShow = true;
  $: contentStyle = !contentShow ? 'display: none' : '';

  function load(node) {
    setHeight(node);
    const handler = createHandler(node);
    addListeners(handler);
    setTimeout(() => {
      handler();
    });
    const observer = observeNode(node, handler);

    return {
      destroy: () => {
        removeListeners(handler);
        observer.unobserve(node);
      },
    };
  }

  function createHandler(node) {
    const handler = throttle(e => {
      const nodeTop = node.getBoundingClientRect().top;
      const nodeBottom = node.getBoundingClientRect().bottom;
      const expectedTop = getContainerHeight(e) + offset;

      if (nodeTop <= expectedTop && nodeBottom > 0) {
        loadNode(node);
      } else if (!keep) {
        unload(node)
      }
    }, 200);
    return handler;
  }

  function observeNode(node, handler) {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadNode(node);
      }
    })
    observer.observe(node);
    return observer;
  }

  function unload(node) {
    setHeight(node);
    loaded = false
  }

  function loadNode(node, handler) {
    if (loaded) {
      return;
    }

    loaded = true;
    resetHeight(node);
    if (onload) {
      onload(node);
    }
  }

  function addListeners(handler) {
    document.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
  }

  function removeListeners(handler) {
    document.removeEventListener('scroll', handler, true);
    window.removeEventListener('resize', handler);
  }

  function getStyleHeight() {
    return (typeof height === 'number')
      ? height + 'px'
      : height;
  }

  function setHeight(node) {
    if (height) {
      node.style.height = getStyleHeight();
    }
  }

  function resetHeight(node) {
    setTimeout(() => {
      node.style.height = 'auto';
    }, resetHeightDelay);
  }

  function getContainerHeight(e) {
    if (e?.target?.getBoundingClientRect) {
      return e.target.getBoundingClientRect().bottom;
    } else {
      return window.innerHeight;
    }
  }

  function throttle(func, wait, options) {
    let context, args, result;
    let timeout = null;
    let previous = 0;
    if (!options) options = {};
    const later = function() {
      previous = options.leading === false ? 0 : new Date();
      timeout = null;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    };

    return function(event) {
      const now = new Date();
      if (!previous && options.leading === false) previous = now;
      const remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0 || remaining > wait) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        previous = now;
        result = func.apply(context, args);
        if (!timeout) context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  }
</script>
