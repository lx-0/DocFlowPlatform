const AdmZip = require('adm-zip');
const RULES = require('../config/formatting-rules.json');

// Convert points to half-points (DOCX font size unit)
function ptToHalfPt(pt) {
  return pt * 2;
}

// Convert points to twips (DOCX spacing unit: 1pt = 20 twips)
function ptToTwips(pt) {
  return Math.round(pt * 20);
}

// Apply page margins to word/document.xml
function applyMargins(docXml, margins) {
  const pgMarAttrs = [
    `w:top="${margins.top}"`,
    `w:right="${margins.right}"`,
    `w:bottom="${margins.bottom}"`,
    `w:left="${margins.left}"`,
    `w:header="720"`,
    `w:footer="720"`,
    `w:gutter="0"`,
  ].join(' ');

  const newPgMar = `<w:pgMar ${pgMarAttrs}/>`;

  // Replace existing self-closing pgMar
  if (/<w:pgMar[^/]*\/>/.test(docXml)) {
    return docXml.replace(/<w:pgMar[^/]*\/>/g, newPgMar);
  }

  // Replace existing block-form pgMar
  if (/<w:pgMar[\s\S]*?>[\s\S]*?<\/w:pgMar>/.test(docXml)) {
    return docXml.replace(/<w:pgMar[\s\S]*?>[\s\S]*?<\/w:pgMar>/g, newPgMar);
  }

  // No existing pgMar — insert before </w:sectPr>
  if (docXml.includes('</w:sectPr>')) {
    return docXml.replace('</w:sectPr>', `${newPgMar}</w:sectPr>`);
  }

  // No sectPr at all — append a minimal sectPr
  return docXml.replace('</w:body>', `<w:sectPr>${newPgMar}</w:sectPr></w:body>`);
}

// Apply default font and size to the docDefaults section of styles.xml
function applyDocumentDefaults(stylesXml, rules) {
  const { family, sizePt } = rules.defaultFont;
  const halfPt = ptToHalfPt(sizePt);

  const rFonts = `<w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}"/>`;
  const sz = `<w:sz w:val="${halfPt}"/>`;
  const szCs = `<w:szCs w:val="${halfPt}"/>`;
  const newRPr = `<w:rPr>${rFonts}${sz}${szCs}</w:rPr>`;
  const newRPrDefault = `<w:rPrDefault>${newRPr}</w:rPrDefault>`;

  if (/<w:rPrDefault>/.test(stylesXml)) {
    return stylesXml.replace(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/g, newRPrDefault);
  }

  if (/<w:docDefaults>/.test(stylesXml)) {
    return stylesXml.replace('<w:docDefaults>', `<w:docDefaults>${newRPrDefault}`);
  }

  // No docDefaults — insert before the first <w:style
  return stylesXml.replace('<w:style', `<w:docDefaults>${newRPrDefault}</w:docDefaults><w:style`);
}

// Modify a single named heading style in styles.xml
function applyHeadingStyle(stylesXml, styleId, config, spacingBeforePt, spacingAfterPt) {
  const halfPt = ptToHalfPt(config.sizePt);
  const beforeTwips = ptToTwips(spacingBeforePt);
  const afterTwips = ptToTwips(spacingAfterPt);

  const rFonts = `<w:rFonts w:ascii="${config.family}" w:hAnsi="${config.family}" w:cs="${config.family}"/>`;
  const bold = config.bold ? '<w:b/><w:bCs/>' : '';
  const sz = `<w:sz w:val="${halfPt}"/><w:szCs w:val="${halfPt}"/>`;
  const newRPrContent = `${rFonts}${bold}${sz}`;
  const newSpacing = `<w:spacing w:before="${beforeTwips}" w:after="${afterTwips}"/>`;

  const styleRegex = new RegExp(
    `(<w:style[^>]*w:styleId="${styleId}"[^>]*>)([\\s\\S]*?)(<\\/w:style>)`,
  );

  if (!styleRegex.test(stylesXml)) {
    return stylesXml; // Style not present — skip
  }

  return stylesXml.replace(styleRegex, (match, open, body, close) => {
    let newBody = body;

    // Apply rPr (run properties = font/size/bold)
    if (/<w:rPr>/.test(newBody)) {
      newBody = newBody.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, `<w:rPr>${newRPrContent}</w:rPr>`);
    } else {
      newBody += `<w:rPr>${newRPrContent}</w:rPr>`;
    }

    // Apply spacing inside pPr (paragraph properties)
    if (/<w:pPr>/.test(newBody)) {
      if (/<w:spacing/.test(newBody)) {
        newBody = newBody.replace(/<w:spacing[^/]*\/>/g, newSpacing);
      } else {
        newBody = newBody.replace('<w:pPr>', `<w:pPr>${newSpacing}`);
      }
    } else {
      newBody += `<w:pPr>${newSpacing}</w:pPr>`;
    }

    return `${open}${newBody}${close}`;
  });
}

// Apply paragraph and line spacing to the Normal style in styles.xml
function applyNormalStyle(stylesXml, rules) {
  const beforeTwips = ptToTwips(rules.paragraphSpacing.beforePt);
  const afterTwips = ptToTwips(rules.paragraphSpacing.afterPt);
  // DOCX line spacing: 240 = single (1.0x)
  const lineVal = Math.round(rules.lineSpacing.multiple * 240);

  const newSpacing = `<w:spacing w:before="${beforeTwips}" w:after="${afterTwips}" w:line="${lineVal}" w:lineRule="auto"/>`;

  const normalRegex = /(<w:style[^>]*w:styleId="Normal"[^>]*>)([\s\S]*?)(<\/w:style>)/;

  if (!normalRegex.test(stylesXml)) {
    return stylesXml;
  }

  return stylesXml.replace(normalRegex, (match, open, body, close) => {
    let newBody = body;

    if (/<w:pPr>/.test(newBody)) {
      if (/<w:spacing/.test(newBody)) {
        newBody = newBody.replace(/<w:spacing[^/]*\/>/g, newSpacing);
      } else {
        newBody = newBody.replace('<w:pPr>', `<w:pPr>${newSpacing}`);
      }
    } else {
      newBody += `<w:pPr>${newSpacing}</w:pPr>`;
    }

    return `${open}${newBody}${close}`;
  });
}

/**
 * Apply company formatting rules to a DOCX file.
 * Reads inputPath, writes formatted DOCX to outputPath.
 */
async function formatDocument(inputPath, outputPath) {
  const zip = new AdmZip(inputPath);

  const docEntry = zip.getEntry('word/document.xml');
  if (docEntry) {
    let docXml = docEntry.getData().toString('utf8');
    docXml = applyMargins(docXml, RULES.margins);
    zip.updateFile('word/document.xml', Buffer.from(docXml, 'utf8'));
  }

  const stylesEntry = zip.getEntry('word/styles.xml');
  if (stylesEntry) {
    let stylesXml = stylesEntry.getData().toString('utf8');
    stylesXml = applyDocumentDefaults(stylesXml, RULES);
    stylesXml = applyHeadingStyle(stylesXml, 'Heading1', RULES.headings.h1, 12, 6);
    stylesXml = applyHeadingStyle(stylesXml, 'Heading2', RULES.headings.h2, 10, 4);
    stylesXml = applyHeadingStyle(stylesXml, 'Heading3', RULES.headings.h3, 8, 4);
    stylesXml = applyNormalStyle(stylesXml, RULES);
    zip.updateFile('word/styles.xml', Buffer.from(stylesXml, 'utf8'));
  }

  zip.writeZip(outputPath);
}

module.exports = {
  formatDocument,
  // Exported for unit testing
  applyMargins,
  applyDocumentDefaults,
  applyHeadingStyle,
  applyNormalStyle,
};
