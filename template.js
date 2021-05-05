class Template {

    constructor(templateElement) {
        this.fragment = templateElement;
        this.vars = {};
        this.eventHandlers = {};
        this.externalIncludeUrl = '/';
        this.tests = {
            'empty': function(v) {
                return typeof v == 'undefined' || v === '' || (typeof v == 'array' && v.length == 0) || (typeof v == 'object' && (function() {
                    for(let i in v)
                        return false;
                    return true;
                })());
            },
            'undefined': function(v) {
                return typeof v == 'undefined';
            }
        };
    }

    static getTemplateById(id) {
        let elm = document.getElementById(id);
        if (elm == null)
            return null;
        if (elm.tagName != 'TEMPLATE')
            return false;

        // cloneNode so later alterations to the template element
        // won't affect the Template object
        return new Template(elm.content.cloneNode(true));
    }

    static createTemplateFromHtml(html) {
        let elm = document.createElement('template');
        elm.innerHTML = html;
        return new Template(elm.content);
    }

    static createTemplateFromExternalHtml(url) {
        return new Promise(function (resolve, reject) {
            let xhr = new XMLHttpRequest();
            xhr.open('GET', url);
            xhr.onload = function () {
                if (this.status >= 200 && this.status < 300) {
                    let template = Template.createTemplateFromHtml(xhr.response);
                    let lastSlashIndex = url.lastIndexOf('/');
                    template.externalIncludeUrl = url.substring(0, lastSlashIndex);
                    resolve(template);
                } else {
                    reject({ status: this.status, statusText: xhr.statusText });
                }
            };
            xhr.onerror = function () {
                reject({ status: this.status, statusText: xhr.statusText });
            };
            xhr.send();
        });
    }

    setVariables(vars) {
        if (typeof vars !== 'object')
            throw new TypeError('vars it not an object');
        this.vars = vars;
    }

    setEventHandlers(eventHandlers) {
        if (typeof eventHandlers !== 'object')
            throw new TypeError('eventHandlers is not an object');
        this.eventHandlers = eventHandlers;
    }

    addTest(name, handler) {
        if (typeof handler != 'function')
            throw new TypeError('Cannot add test ' + name + ', handler is not a function');
        this.tests[name] = handler;
    }

    setExternalIncludeUrl(url) {
        this.externalIncludeUrl = url;
    }

    render() {
        let fragment = this.fragment.cloneNode(true);
        this._processTemplateContent(fragment);
        return fragment;
    }

    _processTemplateContent(fragment) {
        // Process subtemplates
        let childsTemplate = fragment.querySelectorAll('template');
        for(let child of childsTemplate)
            this._preprocessTemplate(child)

        // Fill variables: innerHTML
        let childsHtml = fragment.querySelectorAll('[template-html]');
        for(let child of childsHtml)
            this._processHtmlRule(child);

        // Fill variables: attributes
        let childsAttributes = fragment.querySelectorAll('[template-attr]');
        for(let child of childsAttributes)
            this._processHtmlAttributeRule(child);

        // Assign event handlers
        let childsActions = fragment.querySelectorAll('[template-events]');
        for(let child of childsActions)
            this._processEventsRule(child);
    }

    _processCondition(ifCondition, child) {
        let ifConditionParts = ifCondition.split(/\s+/g);
        let trueResult = false;

        // Boolean test
        if (ifConditionParts.length == 1) {
            trueResult = !!this._getVariableByPath(ifConditionParts[0]);
        }

        // Defined tests and equality comparisons
        else if (ifConditionParts.length == 3) {
            let operator = ifConditionParts[1];

            // Defined tests
            let isNot = operator == 'isnot';
            if (operator == 'is' || isNot) {
                let variableValue = this._getVariableByPath(ifConditionParts[0]);
                let testHandler = this.tests[ifConditionParts[2]];
                if (typeof testHandler == 'undefined') {
                    throw new Error('Test ' + ifConditionParts[2] + ' not found');
                } else {
                    let testResult = testHandler(variableValue, child);
                    if (isNot)
                        trueResult = !testResult;
                    else
                        trueResult = testResult;
                }
            }

            // Regular equality comparisons
            else {
                let leftHand = this._getVariableByPath(ifConditionParts[0]);
                let rightHand = this._getVariableByPath(ifConditionParts[2]);

                switch(operator) {
                    case '==':
                        trueResult = leftHand == rightHand;
                        break;
                    case '>=':
                        trueResult = leftHand >= rightHand;
                        break;
                    case '<=':
                        trueResult = leftHand <= rightHand;
                        break;
                    case '>':
                        trueResult = leftHand > rightHand;
                        break;
                    case '<':
                        trueResult = leftHand < rightHand;
                        break;
                    case '!=':
                        trueResult = leftHand != rightHand;
                        break;
                    case 'contains':
                        trueResult = leftHand.indexOf(rightHand) > -1;
                        break;
                    case 'notcontains':
                        trueResult = leftHand.indexOf(rightHand) == -1;
                        break;
                    case 'in':	
                        trueResult = rightHand.indexOf(leftHand) > -1;	
                        break;	
                    case 'notin':	
                        trueResult = rightHand.indexOf(leftHand) == -1;	
                        break;
                    default:
                        throw new Error('Unknown comparison operator' + operator);
                        break;
                }
            }
        }

        return trueResult;
    }

    _evaluateConditions(child) {
        let ifConditions = child.getAttribute('if').split(/\s+&\s+/g);

        // a | b & c | d = (a | c) & (c | d)
        let totalTrueResult = true;
        for(let ifCondition of ifConditions) {
            let orConditions = ifCondition.split(/\s+\|\s+/g);
            let anyTrue = false;
            for(let orCondition of orConditions) {
                if (this._processCondition(orCondition, child)) {
                    anyTrue = true;
                    break;
                }
            }
            totalTrueResult = totalTrueResult && anyTrue;
            if (!anyTrue)
                return false;
        }

        return totalTrueResult;
    }

    _preprocessTemplate(child) {
        // If conditions
        if (child.hasAttribute('if')) {
            let totalTrueResult = this._evaluateConditions(child);

            let elseIfs = [];
            let elseElms = [];
            let nextElementSibling = child.nextElementSibling;
            while(nextElementSibling) {
                if (nextElementSibling.tagName == 'TEMPLATE') {
                    if (nextElementSibling.hasAttribute('else-if'))
                        elseIfs.push(nextElementSibling);
                    else if (nextElementSibling.hasAttribute('else'))
                        elseElms.push(nextElementSibling);
                    nextElementSibling = nextElementSibling.nextElementSibling;
                }
                else nextElementSibling = null;
            }
            if (elseElms.length > 1) {
                throw new Error('A <template if> cannot contain multiple <template else> elements.');
            }
            let elseElm = elseElms.length == 0 ? null : elseElms[0];

            if (!totalTrueResult) {
                let doneElseif = false;
                if (elseIfs.length) {
                    for (elseIf of elseIfs) {
                        if (this._evaluateConditions(elseIf)) {
                            child.remove();
                            child = elseIf;
                            doneElseif = true;
                            break;
                        }
                    }
                }

                if (!doneElseif) {
                    if (elseElm) {
                        child.remove();
                        child = elseElm;
                    } else {
                        child.remove();
                        return;
                    }
                }
            }
        } else if (child.hasAttribute('else') || child.hasAttribute('else-if')) {
            child.remove();
            return;
        }

        // Include attributes
        // If there is an include attribute, take the content from the
        // referenced template, else use the content of the template tag
        let templateContent;
        if (child.hasAttribute('include')) {
            let includeId = child.getAttribute('include');
            let includeElement = document.getElementById(includeId);
            if (includeElement != null) {
                if (includeElement.tagName != 'TEMPLATE')
                    throw new Error('Cannot include element with id ' + includeId + ', it is not a <template>');

                templateContent = includeElement.content;
            } else
                throw new Error('Cannot find element with id ' + includeId);
        } else if (child.hasAttribute('include-external')) {
            templateContent = document.createDocumentFragment();
            templateContent.appendChild(document.createTextNode('[Cannot inline-load external templates yet]'));
        } else
            templateContent = child.content;

        let originalVariables = this.vars;
        let newVariables = false;
        if (child.hasAttribute('map')) {
            newVariables = {};
            let mapRules = child.getAttribute('map').split(',');
            for(let mapRule of mapRules) {
                let colonIndex = mapRule.indexOf(':');
                let fromVariableName = mapRule.substring(0, colonIndex).trim();
                let toVariableName = mapRule.substring(colonIndex + 1).trim();
                newVariables[toVariableName] = this._getVariableByPath(fromVariableName);
            }
            this.vars = Object.assign({}, originalVariables, newVariables);
        }

        // For-each
        if (child.hasAttribute('for-each'))
            this._processTemplateForEachRule(child, templateContent);
        else {
            let newElement = templateContent.cloneNode(true);
            this._processTemplateContent(newElement);
            this._insertFragmentAfter(newElement, child);
        }

        if (newVariables != false) {
            this.vars = originalVariables;
        }

        child.remove();
    }

    _processTemplateForEachRule(child, templateContent) {
        let forEachRule = child.getAttribute('for-each');
        let colonIndex = forEachRule.indexOf(':');
        if (colonIndex > -1) {
            // Parse rule
            let forEachVariableName = forEachRule.substring(0, colonIndex).trim();
            let useVariableName = forEachRule.substring(colonIndex + 1).trim();
            let forEachVariableValue = this._getVariableByPath(forEachVariableName);

            // Iterate over the value if the value is iterable
            if (Symbol.iterator in Object(forEachVariableValue)) {
                // Save original variables
                let originalVariables = this.vars;

                // Create document fragment to store iteration results
                let newFragment = document.createDocumentFragment();
                for(let forEachValue of forEachVariableValue) {
                    let newElement = templateContent.cloneNode(true);
                    // Merge new variable context with original variables (previous context)
                    let newVars = {};
                    newVars[useVariableName] = forEachValue;
                    this.vars = {};
                    Object.assign(this.vars, originalVariables, newVars);

                    // Process element and add to fragment
                    this._processTemplateContent(newElement);
                    newFragment.appendChild(newElement);
                }

                // Add results and
                this._insertFragmentAfter(newFragment, child);
                this.vars = originalVariables;
            } else {
                throw new TypeError(forEachVariableName + ' is not iterable');
            }
        } else {
            throw new SyntaxError('for-each attribute must follow syntax "<iterable>: <as>"');
        }
    }

    _insertFragmentAfter(fragment, element) {
        if (element.parentNode == null) console.log(element);
        if (element.nextSibling) {
            element.parentNode.insertBefore(fragment, element.nextSibling);
        } else {
            element.parentNode.appendChild(fragment);
        }
    }

    _processHtmlRule(child) {
        let variableName = child.getAttribute('template-html');
        child.innerHTML = this._getVariableByPath(variableName);
        child.removeAttribute('template-html');
    }

    _processHtmlAttributeRule(child) {
        let attributeRules = child.getAttribute('template-attr').split(',');
        for(let attributeRule of attributeRules) {
            let colonIndex = attributeRule.indexOf(':');
            if (colonIndex > -1) {
                let attributeName = attributeRule.substring(0, colonIndex).trim();
                let variableName = attributeRule.substring(colonIndex + 1).trim();
                child.setAttribute(attributeName, this._getVariableByPath(variableName));
            }
            else {
                throw new SynaxError('template-attr attribute must follow syntax "<attribute>: <variable>[, ...]"');
            }
        }
        child.removeAttribute('template-attr');
    }

    _processEventsRule(child) {
        let handlerGroups = child.getAttribute('template-events').split(',');
        for(let handlerGroup of handlerGroups) {
            handlerGroup = handlerGroup.trim();
            if (typeof this.eventHandlers[handlerGroup] != 'undefined') {
                let handlers = this.eventHandlers[handlerGroup];
                for(let eventType in handlers)
                    child.addEventListener(eventType, handlers[eventType]);
            }
            else {
                throw new Error('Event handler group ' + handlerGroup + ' not found');
            }
        }
        child.removeAttribute('template-events');
    }

    _getVariableByPath(path) {
        if (path == 'null')
            return null;
        if (!isNaN(path))
            return +path;
        if (path == 'true')
            return true;
        if (path == 'false')
            return false;
        if (path.substring(0, 1) == '@')
            return path.substring(1);

        let jsonEncode = false;
        if (path.substring(0, 2) == '??') {
            path = path.substring(2);
            jsonEncode = true;
        }

        let throwUndefinedException = true;
        if (path.substring(0, 1) == '$') {
            path = path.substring(1);
            throwUndefinedException = false;
        }

        let pathParts = path.replace(/\[(.+)\]/g, '.$1').split('.');
        let varValue = this.vars;
        for(let pathPart of pathParts) {
            varValue = varValue[pathPart];
            if (typeof varValue == 'undefined') {
                if (throwUndefinedException) {
                    throw new Error(pathPart + ' (in ' + path + ') could not be found');
                }
                else
                    return jsonEncode ? JSON.stringify(varValue) : varValue;
            }
        }
        return jsonEncode ? JSON.stringify(varValue) : varValue;
    }

    clone() {
        let newTemplate = new this(this.fragment.cloneNode(true));
        newTemplate.setEventHandlers(this.eventHandlers);
        newTemplate.setVariables(this.variables);
        newTemplate.tests = this.tests;
        return newTemplate;
    }

}
