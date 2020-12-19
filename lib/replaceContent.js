export default (element, content) => {
    if (typeof content === 'string')
        element.innerHTML = content;
    else {
        element.innerHTML = '';
        if (content) element.appendChild(content);
    }

    return element;
};
