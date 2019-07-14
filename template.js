class Template {
        
    constructor(templateElement) {
        this.fragment = templateElement;
        this.vars = {};
        this.eventHandlers = {};
        this.externalIncludeUrl = '/';
        this.tests = {
            'empty': function(v) {
                return typeof v == 'undefined' || v === '' || (typeof v == 'array' && v.length == 0) || (typeof v == 'object' && (function() {
                    for(var i in v)
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
        var elm = document.getElementById(id);
        if (elm == null)
            return null;
        if (elm.tagName != 'TEMPLATE')
            return false;
        
        // cloneNode so later alterations to the template element
        // won't affect the Template object
        return new Template(elm.content.cloneNode(true));
    }
    
    static createTemplateFromHtml(html) {
        var elm = document.createElement('template');
        elm.innerHTML = html;
        return new Template(elm.content);
    }
    
    static createTemplateFromExternalHtml(url) {
        return new Promise(function (resolve, reject) {
            let xhr = new XMLHttpRequest();
            xhr.open('GET', url);
            xhr.onload = function () {
                if (this.status >= 200 && this.status < 300) {
                    var template = Template.createTemplateFromHtml(xhr.response);
                    var lastSlashIndex = url.lastIndexOf('/');
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
        var fragment = this.fragment.cloneNode(true);
        this._processTemplateContent(fragment);
        return fragment;
    }
    
    _processTemplateContent(fragment) {
        // Process subtemplates
        var childsTemplate = fragment.querySelectorAll('template');
        for(var child of childsTemplate)
            this._preprocessTemplate(child)
                
        // Fill variables: innerHTML
        var childsHtml = fragment.querySelectorAll('[template-html]');
        for(var child of childsHtml)
            this._processHtmlRule(child);
        
        // Fill variables: attributes
        var childsAttributes = fragment.querySelectorAll('[template-attr]');
        for(var child of childsAttributes)
            this._processHtmlAttributeRule(child);
        
        // Assign event handlers
        var childsActions = fragment.querySelectorAll('[template-events]');
        for(var child of childsActions)
            this._processEventsRule(child);
    }
    
    _preprocessTemplate(child) {
        // If conditions
        if (child.hasAttribute('if')) {
            var ifConditionParts = child.getAttribute('if').split(/\s+/g);
            var trueResult = false;
            
            // Boolean test
            if (ifConditionParts.length == 1) {
                trueResult = !!this._getVariableByPath(ifConditionParts[0]);
            }
            
            // Defined tests and equality comparisons
            else if (ifConditionParts.length == 3) {
                var operator = ifConditionParts[1];
                
                // Defined tests
                var isNot = operator == 'isnot';
                if (operator == 'is' || isNot) {
                    var variableValue = this._getVariableByPath(ifConditionParts[0]);
                    var testHandler = this.tests[ifConditionParts[2]];
                    if (typeof testHandler == 'undefined') {
                        throw new Error('Test ' + ifConditionParts[2] + ' not found');
                    } else {
                        var testResult = testHandler(variableValue, child);
                        if (isNot)
                            trueResult = !testResult;
                        else
                            trueResult = testResult;
                    }
                }
                
                // Regular equality comparisons
                else {
                    var leftHand = this._getVariableByPath(ifConditionParts[0]);
                    var rightHand = this._getVariableByPath(ifConditionParts[2]);
                
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
                        default:
                            throw new Error('Unknown comparison operator' + operator);
                            break;
                    }
                }
            }
            
            if (!trueResult) {
                child.remove();
                return;
            }
        }
        
        // Include attributes
        // If there is an include attribute, take the content from the
        // referenced template, else use the content of the template tag
        var templateContent;
        if (child.hasAttribute('include')) {
            var includeId = child.getAttribute('include');
            var includeElement = document.getElementById(includeId);
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
        
        var originalVariables = this.vars;
        var newVariables = false;
        if (child.hasAttribute('map')) {
            newVariables = {};
            var mapRules = child.getAttribute('map').split(',');
            for(var mapRule of mapRules) {
                var colonIndex = mapRule.indexOf(':');
                var fromVariableName = mapRule.substring(0, colonIndex).trim();
                var toVariableName = mapRule.substring(colonIndex + 1).trim();
                newVariables[toVariableName] = this._getVariableByPath(fromVariableName);
            }
            
            Object.assign(this.vars, newVariables);
        }
        
        // For-each
        if (child.hasAttribute('for-each'))
            this._processTemplateForEachRule(child, templateContent);
        else {
            var newElement = templateContent.cloneNode(true);
            this._processTemplateContent(newElement);
            this._insertFragmentAfter(newElement, child);
        }
        
        if (newVariables != false) {
            this.vars = originalVariables;
        }
        
        child.remove();
    }
    
    _processTemplateForEachRule(child, templateContent) {
        var forEachRule = child.getAttribute('for-each');
        var colonIndex = forEachRule.indexOf(':');
        if (colonIndex > -1) {
            // Parse rule
            var forEachVariableName = forEachRule.substring(0, colonIndex).trim();
            var useVariableName = forEachRule.substring(colonIndex + 1).trim();
            var forEachVariableValue = this._getVariableByPath(forEachVariableName);
            
            // Iterate over the value if the value is iterable
            if (Symbol.iterator in Object(forEachVariableValue)) {
                // Save original variables
                var originalVariables = this.vars;
                
                // Create document fragment to store iteration results
                var newFragment = document.createDocumentFragment();
                for(var forEachValue of forEachVariableValue) {
                    var newElement = templateContent.cloneNode(true);
                    // Merge new variable context with original variables (previous context)
                    var newVars = {};
                    newVars[useVariableName] = forEachValue;
                    this.vars = originalVariables;
                    Object.assign(this.vars, newVars);
                    
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
        element.parentNode.insertBefore(fragment, element.nextSibling);
    }
    
    _processHtmlRule(child) {
        var variableName = child.getAttribute('template-html');
        child.innerHTML = this._getVariableByPath(variableName);
        child.removeAttribute('template-html');
    }
    
    _processHtmlAttributeRule(child) {
        var attributeRules = child.getAttribute('template-attr').split(',');
        for(var attributeRule of attributeRules) {
            var colonIndex = attributeRule.indexOf(':');
            if (colonIndex > -1) {
                var attributeName = attributeRule.substring(0, colonIndex).trim();
                var variableName = attributeRule.substring(colonIndex + 1).trim();
                child.setAttribute(attributeName, this._getVariableByPath(variableName));
            }
            else { 
                throw new SynaxError('template-attr attribute must follow syntax "<attribute>: <variable>[, ...]"');
            }
        }
        child.removeAttribute('template-attr');
    }
    
    _processEventsRule(child) {
        var handlerGroups = child.getAttribute('template-events').split(',');
        for(var handlerGroup of handlerGroups) {
            handlerGroup = handlerGroup.trim();
            if (typeof this.eventHandlers[handlerGroup] != 'undefined') {
                var handlers = this.eventHandlers[handlerGroup];
                for(var eventType in handlers)
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
        
        var pathParts = path.replace(/\[(.+)\]/g, '.$1').split('.');
        var varValue = this.vars;
        for(var pathPart of pathParts) {
            varValue = varValue[pathPart];
            if (typeof varValue == 'undefined') {
                throw new Error(pathPart + ' (in ' + path + ') could not be found');
            }
        }
        return varValue;
    }
    
    clone() {
        var newTemplate = new this(this.fragment.cloneNode(true));
        newTemplate.setEventHandlers(this.eventHandlers);
        newTemplate.setVariables(this.variables);
        newTemplate.tests = this.tests;
        return newTemplate;
    }
    
}
