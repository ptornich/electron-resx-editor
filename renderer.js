const path = require('path');
const fs = require('fs');
var $ = require('jquery');
global.jQuery = $;
require('jquery-ui-dist/jquery-ui.min');
require('jquery.tabulator');

var folders = JSON.parse(localStorage.getItem("folders"));
var selectedFolder = localStorage.getItem("selectedFolder");
var resxData = []
var resxXmlDocs = {}
var resxDataPopulated = false
var hasPendingChanges = false
var showSyncNote = false

function formatXml(sourceXml)
{
    var xmlDoc = new DOMParser().parseFromString(sourceXml, 'application/xml');
    var xsltDoc = new DOMParser().parseFromString([
        // describes how we want to modify the XML - indent everything
        '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform">',
        '  <xsl:strip-space elements="*"/>',
        '  <xsl:template match="para[content-style][not(text())]">', // change to just text() to strip space in text nodes
        '    <xsl:value-of select="normalize-space(.)"/>',
        '  </xsl:template>',
        '  <xsl:template match="node()|@*">',
        '    <xsl:copy><xsl:apply-templates select="node()|@*"/></xsl:copy>',
        '  </xsl:template>',
        '  <xsl:output indent="yes"/>',
        '</xsl:stylesheet>',
    ].join('\n'), 'application/xml');

    var xsltProcessor = new XSLTProcessor();    
    xsltProcessor.importStylesheet(xsltDoc);
    var resultDoc = xsltProcessor.transformToDocument(xmlDoc);
    var resultXml = new XMLSerializer().serializeToString(resultDoc);
    return resultXml;
};

function appendChildToAllDocs(resxObj) {
    Object.keys(resxXmlDocs).forEach(xmlDocName => {
        var xmlDoc = resxXmlDocs[xmlDocName]
        var xmlNode = $(xmlDoc.xml).find(`data[name=${resxObj.key}]`)[0]
        if(!xmlNode) {
            var value = resxObj[xmlDocName] ? resxObj[xmlDocName] : ""
            var newNode = $.parseXML(String.raw`
            <data name="${resxObj.key}" xml:space="preserve">
                <value>${value}</value>
            </data>`)
            $(xmlDoc.xml).find("root")[0].appendChild(newNode.documentElement)
        }
    })
}

//custom formatter definition
var removeIcon = function(cell, formatterParams, onRendered){
    return "<i class='fa fa-remove'></i>";
};

function showAlert(alertId, sticky) {
    if(sticky) {
        $(`#${alertId}`).fadeTo(2000, 2000)
    }
    else {
        $(`#${alertId}`).fadeTo(2000, 2000).slideUp(1000, function () {
            $(`#${alertId}`).slideUp(1000)})
    }
}

function enableSaveButtons(enable) {
    hasPendingChanges = enable
    
    $('#SaveButton').prop('disabled', !enable);
    $('#DiscardButton').prop('disabled', !enable);

    if(enable) {
        $('#PendingChangesSign').css('height', $("body").css("height"))
        $("#PendingChangesSign rect").attr("fill", "yellow")
        $('#SaveGroupTxt').text("Use can also use Control+S to save")
    }
    else {
        $('#SaveGroupTxt').text("You have no pending changes.")
    }
}

function getFolderIdx(folderPath) {
    var found = false
    for( var i = 0; i < folders.length; i++){ 
        if ( folders[i].folder === folderPath) {
            found = true
            break;
        }
    }
    if(!found){
        i = -1
    }
    return i
}

function getResxDataIdx(key) {
    var found = false
    for(var i = 0; i < resxData.length; i++){ 
        if ( resxData[i].key === key) {
            found = true
            break;
        }
    }
    if(!found){
        i = -1
    }
    return i
}

function getResxTableRow(key, caseInsensitive) {
    var rows = $("#ResxTable").tabulator("getRows")
    var row = null
    key = caseInsensitive ? key.toLowerCase() : key
    for(var i = 0; i < rows.length; i++){ 
        var rowKey = caseInsensitive ? rows[i].row.data.key.toLowerCase() : rows[i].row.data.key
        if ( rowKey === key) {
            row = rows[i]
            break;
        }
    }
    return row
}

function addFolder(folderPath) {
    if(getFolderIdx(folderPath) === -1) {
        folders.push({folder:folderPath})
        localStorage["folders"] = JSON.stringify(folders)
        loadFoldersPage()
    }
}

function removeFolder(folderPath) {
    if(folders)
    {
        folderIdx = getFolderIdx(folderPath)
        folders.splice(folderIdx, 1);
        localStorage["folders"] = JSON.stringify(folders)
        if(selectedFolder && selectedFolder === folderPath){
            localStorage["selectedFolder"] = null
        }
        loadFoldersPage()
    }
}

function loadStartPage() {
    $("#Container").load("start.html", startPageReady)
}

function loadFoldersPage() {
    $("#Container").load("folders.html", foldersPageReady)
}

function folderTableInit() {
    $('#FolderTable').tabulator({
        data:folders,
        layout:"fitData",
        columns:[
            {formatter:removeIcon, headerSort:false, width:40, align:"center", cellClick:function(e, cell){
                removeFolder(cell.getRow().getData().folder)
            }},
            {title:"Folders", field:"folder"}
        ]
    })
}

function resxDataAddOrUpdate(key, value, column) {
    if(!key || !column){
        return
    }
    if(!value) {
        value = ""
    }
    var idx = getResxDataIdx(key)
    if(idx === -1){
        resxData.push({key:key, [column]:value})
    } 
    else {
        resxData[idx][column] = value
    }
}

function populateResxData() {
    if(!selectedFolder){
        return
    }
    resxData = []
    fs.readdir(selectedFolder, function(err, dir) {
        if(err){
            console.error(err);
        }
        else if(dir){
            requests = []
            dir.forEach(function(filePath){
                var filePathArray = filePath.split(".")
                var fileExt = filePathArray.pop()
                if(fileExt === "resx"){
                    var fullFilePath = path.join(selectedFolder, filePath)
                    requests.push(
                        $.ajax({
                            type: "GET",
                            url: fullFilePath,
                            dataType: "xml",
                            success: function(xml) {
                                let xmlKey = filePathArray.join("_")
                                resxXmlDocs[xmlKey] = {xml:xml, filePath:fullFilePath}
                                $(xml).find('data').each(function() {
                                    var key = $(this).attr('name')
                                    var value = $(this).find('value').text()
                                    resxDataAddOrUpdate(key, value, xmlKey)
                                })
                            }
                        }))
                }
            })
            if(!requests.length) {
                resxDataPopulated = true
                loadStartPage()
            }
            else {
                $.when.apply(undefined, requests).then(function() {
                    resxDataPopulated = true
                    loadStartPage()
                })
            }
        }    
    });
}

function resxTableInit() {

    if(!selectedFolder || !resxData){
        return;
    }

    var newRecordFormHtml = `<input class="form-control new-record-field" id="NewRecord_Key" placeholder="Key" />`

    var tableColumns = [
        {formatter:removeIcon, headerSort:false, width:40, align:"center", cellClick:function(e, cell){
            resxTableDelete(cell.getRow().getData().key)
        }},
        {title:"Key", field:"key", editor:"input", headerFilter:"input", validator:"required"}]

        Object.keys(resxXmlDocs).sort().forEach(xmlDocName => {
            tableColumns.push({title:xmlDocName, field:xmlDocName, editor:"textarea", headerFilter:"input"})
            newRecordFormHtml += `<textarea rows="1" class="form-control new-record-field" id="NewRecord_${xmlDocName}" placeholder="Value for ${xmlDocName}" />`
        })
    
    newRecordFormHtml += '<button type="button" class="btn btn-primary btn-form" onclick="resxTableCreate()">Add record</button>'
    $("#NewRecordForm").html(newRecordFormHtml);

    $('#ResxTable').tabulator({
        data:resxData,
        layout:"fitData",
        columns:tableColumns
    })

    $("#ResxTable").on('DOMSubtreeModified', ".tabulator-cell", function(e) {
        if(this.firstChild) {
            $("input").addClass("mousetrap")
            $("textarea").addClass("mousetrap")
            this.firstChild.onfocus = function() {
                this.oldValue = this.value
                this.column = this.parentElement.attributes["tabulator-field"].value
                this.key = $(".tabulator-row-editing").children()[1].firstChild.nodeValue
            }
            this.firstChild.onchange = function() {
                resxTableUpdate(this.key, this.column, this.value, this.oldValue)
            };
        }
    });

}

function resxTableCreate() {
    var fieldPrefix = "NewRecord_"
    var keyValue = $(`#${fieldPrefix}Key`).val()
    if(!keyValue || !keyValue.trim()) {
        showAlert('empty-key-alert')
        return
    }
    if(getResxTableRow(keyValue, true)) {
        showAlert('dup-key-alert')
        return
    }

    var resxObj = {}
    $('.new-record-field').each(function(idx, field){
        if(field.id === fieldPrefix+"Key") {
            resxObj["key"] = field.value
        }
        else {
            resxObj[field.id.replace(fieldPrefix, "")] = field.value
        }
    })
    $("#ResxTable").tabulator("addRow", resxObj, true);

    appendChildToAllDocs(resxObj)

    enableSaveButtons(true)
}

function resxTableDelete(key) {
    var row = getResxTableRow(key);
    if(row) {
        row.delete()
        Object.keys(resxXmlDocs).forEach(xmlDocName => {
            var xmlDoc = resxXmlDocs[xmlDocName]
            var xmlNode = $(xmlDoc.xml).find(`data[name=${key}]`)[0]
            if(xmlNode) {
                xmlNode.remove()
            }
        })        
        enableSaveButtons(true)
    }
}

function resxTableUpdate(key, column, value, oldValue) {
    if(column.toLowerCase() === "key") {
        Object.keys(resxXmlDocs).forEach(xmlDocName => {
            var xmlDoc = resxXmlDocs[xmlDocName]
            var xmlNode = $(xmlDoc.xml).find(`data[name=${oldValue}]`)[0]
            if(xmlNode) {
                xmlNode.attributes["name"].value = value
            }
        })
    }
    else {
        var xmlDoc = resxXmlDocs[column]
        var xmlNode = $(xmlDoc.xml).find(`data[name=${key}]`)[0]
        xmlNode.firstElementChild.innerHTML = value
    }
    enableSaveButtons(true)
}

function checkSyncResxKeys() {
    var needSync = false
    for(var idx in resxData) {
        Object.keys(resxXmlDocs).every(xmlDocName => {
            var canContinue = true
            if(!resxData[idx].hasOwnProperty(xmlDocName)) {
                needSync = true
                canContinue = false
            }
            return canContinue
        })
    }

    if(needSync) {
        for(var i = 0; i < resxData.length; i++){ 
            appendChildToAllDocs(resxData[i])
        }
        showSyncNote = true
        hasPendingChanges = true
        resxDataPopulated = false
        $("#SaveButton").click()    
        loadStartPage()
    }    
}

function startPageReady() {

    $('#ManageFoldersButton').click(function() {
        loadFoldersPage();
    })

    for( var i = 0; i < folders.length; i++){ 
        $('#SelectFolder').append(new Option(folders[i].folder, i))
    }
    
    if(!selectedFolder) {
        selectedFolder = folders[0].folder
        localStorage["selectedFolder"] = selectedFolder
    }
    
    $('#SelectFolder').val(getFolderIdx(selectedFolder))

    $('#SelectFolder').change(function(e) {
        selectedFolder = e.target.selectedOptions[0].text
        localStorage["selectedFolder"] = selectedFolder
        resxDataPopulated = false
        populateResxData()
    })

    $('#SaveButton').click(function() {
        try {
            if(hasPendingChanges) {
                enableSaveButtons(false)
                Object.keys(resxXmlDocs).forEach(xmlDocName => {
                    var xmlDoc = resxXmlDocs[xmlDocName]
                    var xmlString = formatXml((new XMLSerializer()).serializeToString(xmlDoc.xml))
                    fs.writeFile(xmlDoc.filePath, xmlString, 'utf8', function(err) {
                        if(err) {
                            return console.error(err);
                        }
                    }); 
                })
                $("#PendingChangesSign rect").attr("fill", "lightgreen")
            }
        }
        catch (exception) {
            console.error(exception);
            showAlert('error-alert')
        }
    })

    $('#DiscardButton').click(function() {
        enableSaveButtons(false)
        resxDataPopulated = false
        loadStartPage()
    })

    Mousetrap.bind(['command+s', 'ctrl+s'], function() {
        $('#SaveButton').click()
        return false;
    });

    if(selectedFolder && !resxDataPopulated){
        populateResxData()   
    }
    else if(!selectedFolder || (resxDataPopulated && !resxData)){
        showAlert('no-resx-alert')
    }
    else if (selectedFolder && resxDataPopulated && resxData){
        checkSyncResxKeys()
        resxTableInit()
    }

    $("#NewRecord_Key").keydown(function (event) {
        if(event.keyCode == 13) {
            event.preventDefault()
            resxTableCreate();
        }
    })

    if(showSyncNote) {
        showAlert("designer-cs-alert", true)
    }

    if(hasPendingChanges) {
        hasPendingChanges = false
        enableSaveButtons(true)
    }
}

function foldersPageReady() {
    
    $('#BackButton').click(function() {
        loadStartPage()
    })

    $("#AddNewFolderButton").click(function () {
        $("#FolderInput").value = "tst"
        $("#FolderInput").click()
    });

    $("#FolderInput").change(function(e){
        try {
            var folderPathArray = e.target.files[0].path.split(path.sep)
            folderPathArray.pop()
            addFolder(folderPathArray.join(path.sep))
        }
        catch (exception) {
            console.error(exception);
            showAlert('error-alert')
        }
    });

    folderTableInit();    
}

$(document).ready(function() { 
    loadStartPage()
});