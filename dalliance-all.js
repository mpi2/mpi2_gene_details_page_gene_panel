//utility class for mouse projects to get informaiton from the sanger solr instance


//get chromsome, start and stop for an mgi accession
function getLocationForMgi(mgiAccession) {
    var url='http://www.sanger.ac.uk/mouseportal/solr/select?q=MGI:105369&wt=json';
    //console.debug(url);
    this.doCrossDomainRequest(url, function(responseXML) {
            if (!responseXML) {
                return callback([]);
            }

                var entryPoints = new Array();
                
                var segs = responseXML.getElementsByTagName('SEGMENT');
                for (var i = 0; i < segs.length; ++i) {
                    var seg = segs[i];
                    var segId = seg.getAttribute('id');
                    
                    var segSize = seg.getAttribute('size');
                    var segMin, segMax;
                    if (segSize) {
                        segMin = 1; segMax = segSize;
                    } else {
                        segMin = seg.getAttribute('start');
                        segMax = seg.getAttribute('stop');
                    }
                    var segDesc = null;
                    if (seg.firstChild) {
                        segDesc = seg.firstChild.nodeValue;
                    }
                    entryPoints.push(new DASSegment(segId, segMin, segMax, segDesc));
                }          
               callback(entryPoints);
    });		
    
}

function doCrossDomainRequest(url, handler, credentials) {
    // TODO: explicit error handlers?

    if (window.XDomainRequest) {
	var req = new XDomainRequest();
	req.onload = function() {
	    var dom = new ActiveXObject("Microsoft.XMLDOM");
	    dom.async = false;
	    dom.loadXML(req.responseText);
	    handler(dom);
	}
	req.open("get", url);
	req.send('');
    } else {
	var req = new XMLHttpRequest();

	req.onreadystatechange = function() {
	    if (req.readyState == 4) {
              if (req.status == 200 || req.status == 0) {
		  handler(req.responseXML, req);
	      }
            }
	};
	req.open("get", url, true);
	if (credentials) {
	    req.withCredentials = true;
	}
	req.send('');
    }
}

DASSource.prototype.doCrossDomainRequest = function(url, handler) {
    return doCrossDomainRequest(url, handler, this.credentials);
}/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2011
//
// bam.js: indexed binary alignments
//

var BAM_MAGIC = 21840194;
var BAI_MAGIC = 21578050;

function BamFile() {
}

function Vob(b, o) {
    this.block = b;
    this.offset = o;
}

Vob.prototype.toString = function() {
    return '' + this.block + ':' + this.offset;
}

function Chunk(minv, maxv) {
    this.minv = minv; this.maxv = maxv;
}

function makeBam(data, bai, callback) {
    var bam = new BamFile();
    bam.data = data;
    bam.bai = bai;

    bam.data.slice(0, 65536).fetch(function(r) {
	if (!r) {
	    return dlog("Couldn't access BAM");
	}

        var unc = unbgzf(r);
	var uncba = new Uint8Array(unc);

        var magic = readInt(uncba, 0);
        var headLen = readInt(uncba, 4);
        var header = '';
        for (var i = 0; i < headLen; ++i) {
            header += String.fromCharCode(uncba[i + 8]);
        }

        var nRef = readInt(uncba, headLen + 8);
        var p = headLen + 12;

        bam.chrToIndex = {};
        bam.indexToChr = [];
        for (var i = 0; i < nRef; ++i) {
            var lName = readInt(uncba, p);
            var name = '';
            for (var j = 0; j < lName-1; ++j) {
                name += String.fromCharCode(uncba[p + 4 + j]);
            }
            var lRef = readInt(uncba, p + lName + 4);
            // dlog(name + ': ' + lRef);
            bam.chrToIndex[name] = i;
            if (name.indexOf('chr') == 0) {
                bam.chrToIndex[name.substring(3)] = i;
            } else {
                bam.chrToIndex['chr' + name] = i;
            }
            bam.indexToChr.push(name);

            p = p + 8 + lName;
        }

        if (bam.indices) {
            return callback(bam);
        }
    });

    bam.bai.fetch(function(header) {   // Do we really need to fetch the whole thing? :-(
	if (!header) {
	    return dlog("Couldn't access BAI");
	}

        var uncba = new Uint8Array(header);
        var baiMagic = readInt(uncba, 0);
        if (baiMagic != BAI_MAGIC) {
            return dlog('Not a BAI file');
        }

        var nref = readInt(uncba, 4);

        bam.indices = [];

        var p = 8;
        for (var ref = 0; ref < nref; ++ref) {
            var blockStart = p;
            var nbin = readInt(uncba, p); p += 4;
            for (var b = 0; b < nbin; ++b) {
                var bin = readInt(uncba, p);
                var nchnk = readInt(uncba, p+4);
                p += 8 + (nchnk * 16);
            }
            var nintv = readInt(uncba, p); p += 4;
            p += (nintv * 8);
            if (nbin > 0) {
                bam.indices[ref] = new Uint8Array(header, blockStart, p - blockStart);
            }                     
        }
        if (bam.chrToIndex) {
            return callback(bam);
        }
    });
}



BamFile.prototype.blocksForRange = function(refId, min, max) {
    var index = this.indices[refId];
    if (!index) {
        return [];
    }

    var intBinsL = reg2bins(min, max);
    var intBins = [];
    for (var i = 0; i < intBinsL.length; ++i) {
        intBins[intBinsL[i]] = true;
    }
    var leafChunks = [], otherChunks = [];

    var nbin = readInt(index, 0);
    var p = 4;
    for (var b = 0; b < nbin; ++b) {
        var bin = readInt(index, p);
        var nchnk = readInt(index, p+4);
//        dlog('bin=' + bin + '; nchnk=' + nchnk);
        p += 8;
        if (intBins[bin]) {
            for (var c = 0; c < nchnk; ++c) {
                var cs = readVob(index, p);
                var ce = readVob(index, p + 8);
                (bin < 4681 ? otherChunks : leafChunks).push(new Chunk(cs, ce));
                p += 16;
            }
        } else {
            p +=  (nchnk * 16);
        }
    }
//    dlog('leafChunks = ' + miniJSONify(leafChunks));
//    dlog('otherChunks = ' + miniJSONify(otherChunks));

    var nintv = readInt(index, p);
    var lowest = null;
    var minLin = Math.min(min>>14, nintv - 1), maxLin = Math.min(max>>14, nintv - 1);
    for (var i = minLin; i <= maxLin; ++i) {
        var lb =  readVob(index, p + 4 + (i * 8));
        if (!lb) {
            continue;
        }
        if (!lowest || lb.block < lowest.block || lb.offset < lowest.offset) {
            lowest = lb;
        }
    }
    // dlog('Lowest LB = ' + lowest);
    
    var prunedOtherChunks = [];
    if (lowest != null) {
        for (var i = 0; i < otherChunks.length; ++i) {
            var chnk = otherChunks[i];
            if (chnk.maxv.block >= lowest.block && chnk.maxv.offset >= lowest.offset) {
                prunedOtherChunks.push(chnk);
            }
        }
    }
    // dlog('prunedOtherChunks = ' + miniJSONify(prunedOtherChunks));
    otherChunks = prunedOtherChunks;

    var intChunks = [];
    for (var i = 0; i < otherChunks.length; ++i) {
        intChunks.push(otherChunks[i]);
    }
    for (var i = 0; i < leafChunks.length; ++i) {
        intChunks.push(leafChunks[i]);
    }

    intChunks.sort(function(c0, c1) {
        var dif = c0.minv.block - c1.minv.block;
        if (dif != 0) {
            return dif;
        } else {
            return c0.minv.offset - c1.minv.offset;
        }
    });
    var mergedChunks = [];
    if (intChunks.length > 0) {
        var cur = intChunks[0];
        for (var i = 1; i < intChunks.length; ++i) {
            var nc = intChunks[i];
            if (nc.minv.block == cur.maxv.block /* && nc.minv.offset == cur.maxv.offset */) { // no point splitting mid-block
                cur = new Chunk(cur.minv, nc.maxv);
            } else {
                mergedChunks.push(cur);
                cur = nc;
            }
        }
        mergedChunks.push(cur);
    }
//    dlog('mergedChunks = ' + miniJSONify(mergedChunks));

    return mergedChunks;
}

BamFile.prototype.fetch = function(chr, min, max, callback) {
    var thisB = this;

    var chrId = this.chrToIndex[chr];
    var chunks;
    if (chrId === undefined) {
        chunks = [];
    } else {
        chunks = this.blocksForRange(chrId, min, max);
        if (!chunks) {
            callback(null, 'Error in index fetch');
        }
    }
    
    var records = [];
    var index = 0;
    var data;

    function tramp() {
        if (index >= chunks.length) {
            return callback(records);
        } else if (!data) {
            // dlog('fetching ' + index);
            var c = chunks[index];
            var fetchMin = c.minv.block;
            var fetchMax = c.maxv.block + (1<<16); // *sigh*
            thisB.data.slice(fetchMin, fetchMax - fetchMin).fetch(function(r) {
                data = unbgzf(r, c.maxv.block - c.minv.block + 1);
                return tramp();
            });
        } else {
            var ba = new Uint8Array(data);
            thisB.readBamRecords(ba, chunks[index].minv.offset, records, min, max, chrId);
            data = null;
            ++index;
            return tramp();
        }
    }
    tramp();
}

var SEQRET_DECODER = ['=', 'A', 'C', 'x', 'G', 'x', 'x', 'x', 'T', 'x', 'x', 'x', 'x', 'x', 'x', 'N'];
var CIGAR_DECODER = ['M', 'I', 'D', 'N', 'S', 'H', 'P', '=', 'X', '?', '?', '?', '?', '?', '?', '?'];

function BamRecord() {
}

BamFile.prototype.readBamRecords = function(ba, offset, sink, min, max, chrId) {
    while (true) {
        var blockSize = readInt(ba, offset);
        var blockEnd = offset + blockSize + 4;
        if (blockEnd >= ba.length) {
            return sink;
        }

        var record = new BamRecord();

        var refID = readInt(ba, offset + 4);
        var pos = readInt(ba, offset + 8);
        
        var bmn = readInt(ba, offset + 12);
        var bin = (bmn & 0xffff0000) >> 16;
        var mq = (bmn & 0xff00) >> 8;
        var nl = bmn & 0xff;

        var flag_nc = readInt(ba, offset + 16);
        var flag = (flag_nc & 0xffff0000) >> 16;
        var nc = flag_nc & 0xffff;
    
        var lseq = readInt(ba, offset + 20);
        
        var nextRef  = readInt(ba, offset + 24);
        var nextPos = readInt(ba, offset + 28);
        
        var tlen = readInt(ba, offset + 32);
    
        var readName = '';
        for (var j = 0; j < nl-1; ++j) {
            readName += String.fromCharCode(ba[offset + 36 + j]);
        }
    
        var p = offset + 36 + nl;

        var cigar = '';
        for (var c = 0; c < nc; ++c) {
            var cigop = readInt(ba, p);
            cigar = cigar + (cigop>>4) + CIGAR_DECODER[cigop & 0xf];
            p += 4;
        }
        record.cigar = cigar;
    
        var seq = '';
        var seqBytes = (lseq + 1) >> 1;
        for (var j = 0; j < seqBytes; ++j) {
            var sb = ba[p + j];
            seq += SEQRET_DECODER[(sb & 0xf0) >> 4];
            seq += SEQRET_DECODER[(sb & 0x0f)];
        }
        p += seqBytes;
        record.seq = seq;

        var qseq = '';
        for (var j = 0; j < lseq; ++j) {
            qseq += String.fromCharCode(ba[p + j]);
        }
        p += lseq;
        record.quals = qseq;
        
        record.pos = pos;
        record.mq = mq;
        record.readName = readName;
        record.segment = this.indexToChr[refID];

        while (p < blockEnd) {
            var tag = String.fromCharCode(ba[p]) + String.fromCharCode(ba[p + 1]);
            var type = String.fromCharCode(ba[p + 2]);
            var value;

            if (type == 'A') {
                value = String.fromCharCode(ba[p + 3]);
                p += 4;
            } else if (type == 'i' || type == 'I') {
                value = readInt(ba, p + 3);
                p += 7;
            } else if (type == 'c' || type == 'C') {
                value = ba[p + 3];
                p += 4;
            } else if (type == 's' || type == 'S') {
                value = readShort(ba, p + 3);
                p += 5;
            } else if (type == 'f') {
                throw 'FIXME need floats';
            } else if (type == 'Z') {
                p += 3;
                value = '';
                for (;;) {
                    var cc = ba[p++];
                    if (cc == 0) {
                        break;
                    } else {
                        value += String.fromCharCode(cc);
                    }
                }
            } else {
                throw 'Unknown type '+ type;
            }
            record[tag] = value;
        }

        if (!min || record.pos <= max && record.pos + lseq >= min) {
            if (chrId === undefined || refID == chrId) {
                sink.push(record);
            }
        }
        offset = blockEnd;
    }

    // Exits via top of loop.
}

function readInt(ba, offset) {
    return (ba[offset + 3] << 24) | (ba[offset + 2] << 16) | (ba[offset + 1] << 8) | (ba[offset]);
}

function readShort(ba, offset) {
    return (ba[offset + 1] << 8) | (ba[offset]);
}

function readVob(ba, offset) {
    var block = ((ba[offset+6] & 0xff) * 0x100000000) + ((ba[offset+5] & 0xff) * 0x1000000) + ((ba[offset+4] & 0xff) * 0x10000) + ((ba[offset+3] & 0xff) * 0x100) + ((ba[offset+2] & 0xff));
    var bint = (ba[offset+1] << 8) | (ba[offset]);
    if (block == 0 && bint == 0) {
        return null;  // Should only happen in the linear index?
    } else {
        return new Vob(block, bint);
    }
}

function unbgzf(data, lim) {
    lim = Math.min(lim || 1, data.byteLength - 100);
    var oBlockList = [];
    var ptr = [0];
    var totalSize = 0;

    while (ptr[0] < lim) {
        var ba = new Uint8Array(data, ptr[0], 100); // FIXME is this enough for all credible BGZF block headers?
        var xlen = (ba[11] << 8) | (ba[10]);
        // dlog('xlen[' + (ptr[0]) +']=' + xlen);
        var unc = jszlib_inflate_buffer(data, 12 + xlen + ptr[0], Math.min(65536, data.byteLength - 12 - xlen - ptr[0]), ptr);
        ptr[0] += 8;
        totalSize += unc.byteLength;
        oBlockList.push(unc);
    }

    if (oBlockList.length == 1) {
        return oBlockList[0];
    } else {
        var out = new Uint8Array(totalSize);
        var cursor = 0;
        for (var i = 0; i < oBlockList.length; ++i) {
            var b = new Uint8Array(oBlockList[i]);
            arrayCopy(b, 0, out, cursor, b.length);
            cursor += b.length;
        }
        return out.buffer;
    }
}

//
// Binning (transliterated from SAM1.3 spec)
//

/* calculate bin given an alignment covering [beg,end) (zero-based, half-close-half-open) */
function reg2bin(beg, end)
{
    --end;
    if (beg>>14 == end>>14) return ((1<<15)-1)/7 + (beg>>14);
    if (beg>>17 == end>>17) return ((1<<12)-1)/7 + (beg>>17);
    if (beg>>20 == end>>20) return ((1<<9)-1)/7 + (beg>>20);
    if (beg>>23 == end>>23) return ((1<<6)-1)/7 + (beg>>23);
    if (beg>>26 == end>>26) return ((1<<3)-1)/7 + (beg>>26);
    return 0;
}

/* calculate the list of bins that may overlap with region [beg,end) (zero-based) */
var MAX_BIN = (((1<<18)-1)/7);
function reg2bins(beg, end) 
{
    var i = 0, k, list = [];
    --end;
    list.push(0);
    for (k = 1 + (beg>>26); k <= 1 + (end>>26); ++k) list.push(k);
    for (k = 9 + (beg>>23); k <= 9 + (end>>23); ++k) list.push(k);
    for (k = 73 + (beg>>20); k <= 73 + (end>>20); ++k) list.push(k);
    for (k = 585 + (beg>>17); k <= 585 + (end>>17); ++k) list.push(k);
    for (k = 4681 + (beg>>14); k <= 4681 + (end>>14); ++k) list.push(k);
    return list;
}/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// bigwig.js: indexed binary WIG (and BED) files
//

var BIG_WIG_MAGIC = -2003829722;
var BIG_BED_MAGIC = -2021002517;

var BIG_WIG_TYPE_GRAPH = 1;
var BIG_WIG_TYPE_VSTEP = 2;
var BIG_WIG_TYPE_FSTEP = 3;
    
function BigWig() {
}

BigWig.prototype.readChromTree = function(callback) {
    var thisB = this;
    this.chromsToIDs = {};
    this.idsToChroms = {};

    var udo = this.unzoomedDataOffset;
    while ((udo % 4) != 0) {
        ++udo;
    }

    this.data.slice(this.chromTreeOffset, udo - this.chromTreeOffset).fetch(function(bpt) {
	var ba = new Uint8Array(bpt);
	var sa = new Int16Array(bpt);
	var la = new Int32Array(bpt);
	var bptMagic = la[0];
	var blockSize = la[1];
	var keySize = la[2];
	var valSize = la[3];
	var itemCount = (la[4] << 32) | (la[5]);
	var rootNodeOffset = 32;
	
        // dlog('blockSize=' + blockSize + '    keySize=' + keySize + '   valSize=' + valSize + '    itemCount=' + itemCount);

	var bptReadNode = function(offset) {
	    var nodeType = ba[offset];
	    var cnt = sa[(offset/2) + 1];
	    // dlog('ReadNode: ' + offset + '     type=' + nodeType + '   count=' + cnt);
	    offset += 4;
	    for (var n = 0; n < cnt; ++n) {
		if (nodeType == 0) {
		    offset += keySize;
		    var childOffset = (la[offset/4] << 32) | (la[offset/4 + 1]);
		    offset += 8;
		    childOffset -= thisB.chromTreeOffset;
		    bptReadNode(childOffset);
		} else {
		    var key = '';
		    for (var ki = 0; ki < keySize; ++ki) {
			var charCode = ba[offset++];
			if (charCode != 0) {
			    key += String.fromCharCode(charCode);
			}
		    }
		    var chromId = (ba[offset+3]<<24) | (ba[offset+2]<<16) | (ba[offset+1]<<8) | (ba[offset+0]);
		    var chromSize = (ba[offset + 7]<<24) | (ba[offset+6]<<16) | (ba[offset+5]<<8) | (ba[offset+4]);
		    offset += 8;

		    // dlog(key + ':' + chromId + ',' + chromSize);
		    thisB.chromsToIDs[key] = chromId;
		    if (key.indexOf('chr') == 0) {
			thisB.chromsToIDs[key.substr(3)] = chromId;
		    }
                    thisB.idsToChroms[chromId] = key;
		}
	    }
	};
	bptReadNode(rootNodeOffset);

	callback(thisB);
    });
}

function BigWigView(bwg, cirTreeOffset, cirTreeLength, isSummary) {
    this.bwg = bwg;
    this.cirTreeOffset = cirTreeOffset;
    this.cirTreeLength = cirTreeLength;
    this.isSummary = isSummary;
}

BigWigView.prototype.readWigData = function(chrName, min, max, callback) {
    var chr = this.bwg.chromsToIDs[chrName];
    if (chr === undefined) {
        // Not an error because some .bwgs won't have data for all chromosomes.

        // dlog("Couldn't find chr " + chrName);
        // dlog('Chroms=' + miniJSONify(this.bwg.chromsToIDs));
        return callback([]);
    } else {
        this.readWigDataById(chr, min, max, callback);
    }
}

BigWigView.prototype.readWigDataById = function(chr, min, max, callback) {
    var thisB = this;
    if (!this.cirHeader) {
	// dlog('No CIR yet, fetching');
        this.bwg.data.slice(this.cirTreeOffset, 48).fetch(function(result) {
	    thisB.cirHeader = result;
            var la = new Int32Array(thisB.cirHeader);
            thisB.cirBlockSize = la[1];
	    thisB.readWigDataById(chr, min, max, callback);
	});
	return;
    }

    var blocksToFetch = [];
    var outstanding = 0;

    var beforeBWG = Date.now();

    var cirFobRecur = function(offset, level) {
        outstanding += offset.length;

        var maxCirBlockSpan = 4 +  (thisB.cirBlockSize * 32);   // Upper bound on size, based on a completely full leaf node.
        var spans;
        for (var i = 0; i < offset.length; ++i) {
            var blockSpan = new Range(offset[i], Math.min(offset[i] + maxCirBlockSpan, thisB.cirTreeOffset + thisB.cirTreeLength));
            spans = spans ? union(spans, blockSpan) : blockSpan;
        }
        
        var fetchRanges = spans.ranges();
        // dlog('fetchRanges: ' + fetchRanges);
        for (var r = 0; r < fetchRanges.length; ++r) {
            var fr = fetchRanges[r];
            cirFobStartFetch(offset, fr, level);
        }
    }

    var cirFobStartFetch = function(offset, fr, level, attempts) {
        var length = fr.max() - fr.min();
        // dlog('fetching ' + fr.min() + '-' + fr.max() + ' (' + (fr.max() - fr.min()) + ')');
        thisB.bwg.data.slice(fr.min(), fr.max() - fr.min()).fetch(function(resultBuffer) {
            for (var i = 0; i < offset.length; ++i) {
                if (fr.contains(offset[i])) {
                    cirFobRecur2(resultBuffer, offset[i] - fr.min(), level);
                    --outstanding;
                    if (outstanding == 0) {
                        cirCompleted();
                    }
                }
            }
        });
    }

    var cirFobRecur2 = function(cirBlockData, offset, level) {
        var ba = new Int8Array(cirBlockData);
        var sa = new Int16Array(cirBlockData);
        var la = new Int32Array(cirBlockData);

	var isLeaf = ba[offset];
	var cnt = sa[offset/2 + 1];
        // dlog('cir level=' + level + '; cnt=' + cnt);
	offset += 4;

	if (isLeaf != 0) {
	    for (var i = 0; i < cnt; ++i) {
		var lo = offset/4;
		var startChrom = la[lo];
		var startBase = la[lo + 1];
		var endChrom = la[lo + 2];
		var endBase = la[lo + 3];
		var blockOffset = (la[lo + 4]<<32) | (la[lo + 5]);
		var blockSize = (la[lo + 6]<<32) | (la[lo + 7]);
		if ((startChrom < chr || (startChrom == chr && startBase <= max)) &&
		    (endChrom   > chr || (endChrom == chr && endBase >= min)))
		{
		    // dlog('Got an interesting block: startBase=' + startBase + '; endBase=' + endBase + '; offset=' + blockOffset + '; size=' + blockSize);
		    blocksToFetch.push({offset: blockOffset, size: blockSize});
		}
		offset += 32;
	    }
	} else {
            var recurOffsets = [];
	    for (var i = 0; i < cnt; ++i) {
		var lo = offset/4;
		var startChrom = la[lo];
		var startBase = la[lo + 1];
		var endChrom = la[lo + 2];
		var endBase = la[lo + 3];
		var blockOffset = (la[lo + 4]<<32) | (la[lo + 5]);
		if ((startChrom < chr || (startChrom == chr && startBase <= max)) &&
		    (endChrom   > chr || (endChrom == chr && endBase >= min)))
		{
                    recurOffsets.push(blockOffset);
		}
		offset += 24;
	    }
            if (recurOffsets.length > 0) {
                cirFobRecur(recurOffsets, level + 1);
            }
	}
    };
    

    var cirCompleted = function() {
        blocksToFetch.sort(function(b0, b1) {
            return (b0.offset|0) - (b1.offset|0);
        });

        if (blocksToFetch.length == 0) {
	    callback([]);
        } else {
	    var features = [];
	    var createFeature = function(fmin, fmax, opts) {
                // dlog('createFeature(' + fmin +', ' + fmax + ')');

                if (!opts) {
                    opts = {};
                }
            
                var f = new DASFeature();
                f.segment = thisB.bwg.idsToChroms[chr];
                f.min = fmin;
                f.max = fmax;
                f.type = 'bigwig';
                
                for (k in opts) {
                    f[k] = opts[k];
                }
                
	        features.push(f);
	    };
            var maybeCreateFeature = function(fmin, fmax, opts) {
                if (fmin <= max && fmax >= min) {
                    createFeature(fmin, fmax, opts);
                }
            };
	    var tramp = function() {
	        if (blocksToFetch.length == 0) {
                    var afterBWG = Date.now();
                    // dlog('BWG fetch took ' + (afterBWG - beforeBWG) + 'ms');
		    callback(features);
		    return;  // just in case...
	        } else {
		    var block = blocksToFetch[0];
		    if (block.data) {
                        var ba = new Uint8Array(block.data);

                        if (thisB.isSummary) {
                            var sa = new Int16Array(block.data);
		            var la = new Int32Array(block.data);
		            var fa = new Float32Array(block.data);

                            var itemCount = block.data.byteLength/32;
                            for (var i = 0; i < itemCount; ++i) {
                                var chromId =   la[(i*8)];
                                var start =     la[(i*8)+1];
                                var end =       la[(i*8)+2];
                                var validCnt =  la[(i*8)+3];
                                var minVal    = fa[(i*8)+4];
                                var maxVal    = fa[(i*8)+5];
                                var sumData   = fa[(i*8)+6];
                                var sumSqData = fa[(i*8)+7];
                                
                                if (chromId == chr) {
                                    var summaryOpts = {type: 'bigwig', score: sumData/validCnt};
                                    if (thisB.bwg.type == 'bigbed') {
                                        summaryOpts.type = 'density';
                                    }
                                    maybeCreateFeature(start, end, summaryOpts);
                                }
                            }
                        } else if (thisB.bwg.type == 'bigwig') {
		            var sa = new Int16Array(block.data);
		            var la = new Int32Array(block.data);
		            var fa = new Float32Array(block.data);

		            var chromId = la[0];
		            var blockStart = la[1];
		            var blockEnd = la[2];
		            var itemStep = la[3];
		            var itemSpan = la[4];
		            var blockType = ba[20];
		            var itemCount = sa[11];

                            // dlog('processing bigwig block, type=' + blockType + '; count=' + itemCount);
                            
		            if (blockType == BIG_WIG_TYPE_FSTEP) {
			        for (var i = 0; i < itemCount; ++i) {
			            var score = fa[i + 6];
			            maybeCreateFeature(blockStart + (i*itemStep), blockStart + (i*itemStep) + itemSpan, {score: score});
			        }
		            } else if (blockType == BIG_WIG_TYPE_VSTEP) {
			        for (var i = 0; i < itemCount; ++i) {
			            var start = la[(i*2) + 6];
			            var score = fa[(i*2) + 7];
			            maybeCreateFeature(start, start + itemSpan, {score: score});
			        }
		            } else if (blockType == BIG_WIG_TYPE_GRAPH) {
			        for (var i = 0; i < itemCount; ++i) {
			            var start = la[(i*3) + 6];
			            var end   = la[(i*3) + 7];
			            var score = fa[(i*3) + 8];
			            maybeCreateFeature(start, end, {score: score});
			        }
		            } else {
			        dlog('Currently not handling bwgType=' + blockType);
		            }
                        } else if (thisB.bwg.type == 'bigbed') {
                            var offset = 0;
                            while (offset < ba.length) {
                                var chromId = (ba[offset+3]<<24) | (ba[offset+2]<<16) | (ba[offset+1]<<8) | (ba[offset+0]);
                                var start = (ba[offset+7]<<24) | (ba[offset+6]<<16) | (ba[offset+5]<<8) | (ba[offset+4]);
                                var end = (ba[offset+11]<<24) | (ba[offset+10]<<16) | (ba[offset+9]<<8) | (ba[offset+8]);
                                offset += 12;
                                var rest = '';
                                while (true) {
                                    var ch = ba[offset++];
                                    if (ch != 0) {
                                        rest += String.fromCharCode(ch);
                                    } else {
                                        break;
                                    }
                                }

                                var featureOpts = {};
                                
                                var bedColumns = rest.split('\t');
                                if (bedColumns.length > 0) {
                                    featureOpts.label = bedColumns[0];
                                }
                                if (bedColumns.length > 1) {
                                    featureOpts.score = 100; /* bedColumns[1]; */
                                }
                                if (bedColumns.length > 2) {
                                    featureOpts.orientation = bedColumns[2];
                                }

                                if (bedColumns.length < 9) {
                                    if (chromId == chr) {
                                        maybeCreateFeature(start + 1, end, featureOpts);
                                    }
                                } else if (chromId == chr && start <= max && end >= min) {
                                    // Complex-BED?
                                    // FIXME this is currently a bit of a hack to do Clever Things with ensGene.bb

                                    var thickStart = bedColumns[3]|0;
                                    var thickEnd   = bedColumns[4]|0;
                                    var blockCount = bedColumns[6]|0;
                                    var blockSizes = bedColumns[7].split(',');
                                    var blockStarts = bedColumns[8].split(',');
                                    
                                    featureOpts.type = 'bb-transcript'
                                    var grp = new DASGroup();
                                    grp.id = bedColumns[0];
                                    grp.type = 'bb-transcript'
                                    grp.notes = [];
                                    featureOpts.groups = [grp];

                                    if (bedColumns.length > 10) {
                                        var geneId = bedColumns[9];
                                        var geneName = bedColumns[10];
                                        var gg = new DASGroup();
                                        gg.id = geneId;
                                        gg.label = geneName;
                                        gg.type = 'gene';
                                        featureOpts.groups.push(gg);
                                    }

                                    var spans = null;
                                    for (var b = 0; b < blockCount; ++b) {
                                        var bmin = (blockStarts[b]|0) + start;
                                        var bmax = bmin + (blockSizes[b]|0);
                                        var span = new Range(bmin, bmax);
                                        if (spans) {
                                            spans = union(spans, span);
                                        } else {
                                            spans = span;
                                        }
                                    }
                                    
                                    var tsList = spans.ranges();
                                    for (var s = 0; s < tsList.length; ++s) {
                                        var ts = tsList[s];
                                        createFeature(ts.min() + 1, ts.max(), featureOpts);
                                    }

                                    var tl = intersection(spans, new Range(thickStart, thickEnd));
                                    if (tl) {
                                        featureOpts.type = 'bb-translation';
                                        var tlList = tl.ranges();
                                        for (var s = 0; s < tlList.length; ++s) {
                                            var ts = tlList[s];
                                            createFeature(ts.min() + 1, ts.max(), featureOpts);
                                        }
                                    }
                                }
                            }
                        } else {
                            dlog("Don't know what to do with " + thisB.bwg.type);
                        }
		        blocksToFetch.splice(0, 1);
		        tramp();
		    } else {
                        var fetchStart = block.offset;
                        var fetchSize = block.size;
                        var bi = 1;
                        while (bi < blocksToFetch.length && blocksToFetch[bi].offset == (fetchStart + fetchSize)) {
                            fetchSize += blocksToFetch[bi].size;
                            ++bi;
                        }

		        thisB.bwg.data.slice(fetchStart, fetchSize).fetch(function(result) {
                            var offset = 0;
                            var bi = 0;
                            while (offset < fetchSize) {
                                var fb = blocksToFetch[bi];
                            
                                var data;
                                if (thisB.bwg.uncompressBufSize > 0) {
                                    // var beforeInf = Date.now();
                                    data = jszlib_inflate_buffer(result, offset + 2, fb.size - 2);
                                    // var afterInf = Date.now();
                                    // dlog('inflate: ' + (afterInf - beforeInf) + 'ms');
                                } else {
                                    var tmp = new Uint8Array(fb.size);    // FIXME is this really the best we can do?
                                    arrayCopy(new Uint8Array(result, offset, fb.size), 0, tmp, 0, fb.size);
                                    data = tmp.buffer;
                                }
                                fb.data = data;
                                
                                offset += fb.size;
                                ++bi;
                            }
			    tramp();
		        });
		    }
	        }
	    }
	    tramp();
        }
    }

    cirFobRecur([thisB.cirTreeOffset + 48], 1);
}

BigWig.prototype.readWigData = function(chrName, min, max, callback) {
    this.getUnzoomedView().readWigData(chrName, min, max, callback);
}

BigWig.prototype.getUnzoomedView = function() {
    if (!this.unzoomedView) {
        this.unzoomedView = new BigWigView(this, this.unzoomedIndexOffset, this.zoomLevels[0].dataOffset - this.unzoomedIndexOffset, false);
    }
    return this.unzoomedView;
}

BigWig.prototype.getZoomedView = function(z) {
    var zh = this.zoomLevels[z];
    if (!zh.view) {
        zh.view = new BigWigView(this, zh.indexOffset, this.zoomLevels[z + 1].dataOffset - zh.indexOffset, true);
    }
    return zh.view;
}


function makeBwgFromURL(url, callback, creds) {
    makeBwg(new URLFetchable(url, {credentials: creds}), callback, url);
}

function makeBwgFromFile(file, callback) {
    makeBwg(new BlobFetchable(file), callback, 'file');
}

function makeBwg(data, callback, name) {
    var bwg = new BigWig();
    bwg.data = data;
    bwg.name = name;
    bwg.data.slice(0, 512).fetch(function(result) {
        if (!result) {
            return callback(null, "Couldn't fetch file");
        }

        var header = result;
	var sa = new Int16Array(header);
	var la = new Int32Array(header);
	if (la[0] == BIG_WIG_MAGIC) {
            bwg.type = 'bigwig';
        } else if (la[0] == BIG_BED_MAGIC) {
            bwg.type = 'bigbed';
        } else {
	    callback(null, "Not a supported format");
	}
//        dlog('magic okay');

	bwg.version = sa[2];             // 4
	bwg.numZoomLevels = sa[3];       // 6
	bwg.chromTreeOffset = (la[2] << 32) | (la[3]);     // 8
	bwg.unzoomedDataOffset = (la[4] << 32) | (la[5]);  // 16
        bwg.unzoomedIndexOffset = (la[6] << 32) | (la[7]); // 24
        bwg.fieldCount = sa[16];         // 32
        bwg.definedFieldCount = sa[17];  // 34
        bwg.asOffset = (la[9] << 32) | (la[10]);    // 36 (unaligned longlong)
        bwg.totalSummaryOffset = (la[11] << 32) | (la[12]);    // 44 (unaligned longlong)
        bwg.uncompressBufSize = la[13];  // 52
         
        // dlog('bigType: ' + bwg.type);
	// dlog('chromTree at: ' + bwg.chromTreeOffset);
	// dlog('uncompress: ' + bwg.uncompressBufSize);
	// dlog('data at: ' + bwg.unzoomedDataOffset);
	// dlog('index at: ' + bwg.unzoomedIndexOffset);
        // dlog('field count: ' + bwg.fieldCount);
        // dlog('defined count: ' + bwg.definedFieldCount);

	bwg.zoomLevels = [];
	for (var zl = 0; zl < bwg.numZoomLevels; ++zl) {
	    var zlReduction = la[zl*6 + 16]
	    var zlData = (la[zl*6 + 18]<<32)|(la[zl*6 + 19]);
	    var zlIndex = (la[zl*6 + 20]<<32)|(la[zl*6 + 21]);
//	    dlog('zoom(' + zl + '): reduction=' + zlReduction + '; data=' + zlData + '; index=' + zlIndex);
	    bwg.zoomLevels.push({reduction: zlReduction, dataOffset: zlData, indexOffset: zlIndex});
	}

	bwg.readChromTree(function() {
            return callback(bwg);
	});
    });
}
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2011
//
// bin.js general binary data support
//

function BlobFetchable(b) {
    this.blob = b;
}

BlobFetchable.prototype.slice = function(start, length) {
    var b;
    if (length) {
        b = this.blob.slice(start, length);
    } else {
        b = this.blob.slice(start);
    }
    return new BlobFetchable(b);
}

BlobFetchable.prototype.fetch = function(callback) {
    var reader = new FileReader();
    reader.onloadend = function(ev) {
        callback(bstringToBuffer(reader.result));
    };
    reader.readAsBinaryString(this.blob);
}

function URLFetchable(url, start, end, opts) {
    if (!opts) {
        if (typeof start === 'object') {
            opts = start;
            start = undefined;
        } else {
            opts = {};
        }
    }

    this.url = url;
    this.start = start || 0;
    if (end) {
        this.end = end;
    }
    this.opts = opts;
}

URLFetchable.prototype.slice = function(s, l) {
    var ns = this.start, ne = this.end;
    if (ns && s) {
        ns = ns + s;
    } else {
        ns = s || ns;
    }
    if (l && ns) {
        ne = ns + l - 1;
    } else {
        ne = ne || l - 1;
    }
    return new URLFetchable(this.url, ns, ne, this.opts);
}

URLFetchable.prototype.fetch = function(callback, attempt, truncatedLength) {
    var thisB = this;

    attempt = attempt || 1;
    if (attempt > 3) {
        return callback(null);
    }

    var req = new XMLHttpRequest();
    var length;
    req.open('GET', this.url, true);
    req.overrideMimeType('text/plain; charset=x-user-defined');
    if (this.end) {
        req.setRequestHeader('Range', 'bytes=' + this.start + '-' + this.end);
        length = this.end - this.start + 1;
    }
    req.responseType = 'arraybuffer';
    req.onreadystatechange = function() {
        if (req.readyState == 4) {
            if (req.status == 200 || req.status == 206) {
                if (req.response) {
                    return callback(req.response);
                } else if (req.mozResponseArrayBuffer) {
                    return callback(req.mozResponseArrayBuffer);
                } else {
                    var r = req.responseText;
                    if (length && length != r.length && (!truncatedLength || r.length != truncatedLength)) {
                        return thisB.fetch(callback, attempt + 1, r.length);
                    } else {
                        return callback(bstringToBuffer(req.responseText));
                    }
                }
            } else {
                return thisB.fetch(callback, attempt + 1);
            }
        }
    };
    if (this.opts.credentials) {
        req.withCredentials = true;
    }
    req.send('');
}

function bstringToBuffer(result) {
    if (!result) {
        return null;
    }

//    var before = Date.now();
    var ba = new Uint8Array(result.length);
    for (var i = 0; i < ba.length; ++i) {
        ba[i] = result.charCodeAt(i);
    }
//    var after  = Date.now();
//    dlog('bb took ' + (after - before) + 'ms');
    return ba.buffer;
}

/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// browser.js: browser setup and UI.
//

// constants

var NS_SVG = 'http://www.w3.org/2000/svg';
var NS_HTML = 'http://www.w3.org/1999/xhtml'
var NS_XLINK = 'http://www.w3.org/1999/xlink'

// Limit stops

MAX_VIEW_SIZE=500000;

function Browser(opts) {
    if (!opts) {
        opts = {};
    }
//console.debug('calling dalliance browser constructor');
    this.sources = [];
    this.tiers = [];

    this.cookieKey = 'browser';
    this.karyoEndpoint = new DASSource('http://www.derkholm.net:8080/das/hsa_54_36p/');
    this.registry = 'http://www.dasregistry.org/das/sources';
    this.coordSystem = {
        speciesName: 'Human',
        taxon: 9606,
        auth: 'NCBI',
        version: '36'
    };
    this.chains = {};

    this.exportServer = 'http://www.biodalliance.org:8765/'

    this.pageName = 'svgHolder'
    this.maxExtra = 1.5;
    this.minExtra = 0.2;
    this.zoomFactor = 1.0;
    this.origin = 0;
    this.targetQuantRes = 5.0;
    this.featurePanelWidth = 750;
    this.zoomBase = 100;
    this.zoomExpt = 30; // Now gets clobbered.
    this.entryPoints = null;
    this.currentSeqMax = -1; // init once EPs are fetched.

    this.highlight = false;
    this.highlightMin = -1
    this.highlightMax = - 1;

    this.autoSizeTiers = false;
    this.guidelineStyle = 'foreground';
    this.guidelineSpacing = 75;
    this.fgGuide = null;
    this.positionFeedback = false;

    this.placards = [];

    // Visual config.

    this.tierBackgroundColors = ["rgb(245,245,245)", "rgb(230,230,250)"];
    this.minTierHeight = 25;
    
    this.tabMargin = 120;

    this.browserLinks = {
        Ensembl: 'http://ncbi36.ensembl.org/Homo_sapiens/Location/View?r=${chr}:${start}-${end}',
        UCSC: 'http://genome.ucsc.edu/cgi-bin/hgTracks?db=hg18&position=chr${chr}:${start}-${end}'
    }

    this.iconsURI = 'http://www.biodalliance.org/resources/icons.svg'

    // Registry

    this.availableSources = new Observed();
    this.defaultSources = [];
    this.mappableSources = {};

    for (var k in opts) {
        this[k] = opts[k];
    }

    var thisB = this;
    window.addEventListener('load', function(ev) {thisB.realInit();}, false);
}


function formatQuantLabel(v) {
    var t = '' + v;
    var dot = t.indexOf('.');
    if (dot < 0) {
        return t;
    } else {
        var dotThreshold = 2;
        if (t.substring(0, 1) == '-') {
            ++dotThreshold;
        }

        if (dot >= dotThreshold) {
            return t.substring(0, dot);
        } else {
            return t.substring(0, dot + 2);
        }
    }
}

Browser.prototype.labelForTier = function(tier, ti, labelGroup) {
    var labelWidth = this.tabMargin;
    var viewportBackground = document.createElementNS(NS_SVG, 'path');
    viewportBackground.setAttribute('d', 'M 15 ' + 2 + 
				    ' L 10 ' + 7 +
				    ' L 10 ' + 18 +
				    ' L 15 ' + 22 +
				    ' L ' + (10 + labelWidth) + ' ' + 22 +
				    ' L ' + (10 + labelWidth) + ' ' + 2 + ' Z');
    viewportBackground.setAttribute('fill', this.tierBackgroundColors[ti % this.tierBackgroundColors.length]);
    viewportBackground.setAttribute('stroke', 'none');
    labelGroup.appendChild(viewportBackground);
    this.setupTierDrag(viewportBackground, ti);

    var hasWidget = false;
    if (tier.dasSource.collapseSuperGroups || tier.hasBumpedFeatures) {
        hasWidget = true;
	this.makeToggleButton(labelGroup, tier, 0);
    } 

    if (tier.isQuantitative) {
        hasWidget = true;
        var quantTools = makeElementNS(NS_SVG, 'g');
        quantTools.appendChild(makeElementNS(NS_SVG, 'rect', null, {
            x: this.tabMargin - 25,
            y: 0,
            width: 25,
            height: tier.layoutHeight,
            stroke: 'none',
            fill: this.tierBackgroundColors[ti % this.tierBackgroundColors.length]
        }));
        labelGroup.appendChild(quantTools);
        quantTools.appendChild(makeElementNS(NS_SVG, 'line', null, {
            x1: this.tabMargin,
            y1: 0 + (tier.clientMin|0),
            x2: this.tabMargin,
            y2: 0 + (tier.clientMax|0),
            strokeWidth: 1
        }));
        quantTools.appendChild(makeElementNS(NS_SVG, 'line', null, {
            x1: this.tabMargin -5 ,
            y1: 0 + (tier.clientMin|0),
            x2: this.tabMargin,
            y2: 0 + (tier.clientMin|0),
            strokeWidth: 1
        }));
        quantTools.appendChild(makeElementNS(NS_SVG, 'line', null, {
            x1: this.tabMargin -3 ,
            y1: 0 + ((tier.clientMin|0) +(tier.clientMax|0))/2 ,
            x2: this.tabMargin,
            y2: 0 + ((tier.clientMin|0) +(tier.clientMax|0))/2,
            strokeWidth: 1
        }));
        quantTools.appendChild(makeElementNS(NS_SVG, 'line', null, {
            x1: this.tabMargin -5 ,
            y1: 0 + (tier.clientMax|0),
            x2: this.tabMargin,
            y2: 0 + (tier.clientMax|0),
            strokeWidth: 1
        }));
        var minQ = makeElementNS(NS_SVG, 'text', formatQuantLabel(tier.min), {
            x: 80,
            y:  (tier.clientMin|0),
            strokeWidth: 0,
            fill: 'black',
            fontSize: '8pt'
        });
        quantTools.appendChild(minQ);
        var mqbb = minQ.getBBox();
        minQ.setAttribute('x', this.tabMargin - mqbb.width - 7);
        minQ.setAttribute('y', (tier.clientMin|0) + (mqbb.height/2) - 4);
                    
        var maxQ = makeElementNS(NS_SVG, 'text', formatQuantLabel(tier.max), {
            x: 80,
            y: (tier.clientMax|0),
            strokeWidth: 0,
            fill: 'black',
            fontSize: '8pt'
        });
        quantTools.appendChild(maxQ);
        maxQ.setAttribute('x', this.tabMargin - maxQ.getBBox().width - 3);
        mqbb = maxQ.getBBox();
        maxQ.setAttribute('x', this.tabMargin - mqbb.width - 7);
        maxQ.setAttribute('y', (tier.clientMax|0) + (mqbb.height/2) -1 );
        
        var button = this.icons.createIcon('magnifier', labelGroup);
        button.setAttribute('transform', 'translate(' + (this.tabMargin - 18) + ', ' + ((tier.layoutHeight/2) - 8) + '), scale(0.6,0.6)');
        
        // FIXME style-changes don't currently work because of the way icons get grouped.
        button.addEventListener('mouseover', function(ev) {
	    button.setAttribute('fill', 'red');
        }, false);
        button.addEventListener('mouseout', function(ev) {
	    button.setAttribute('stroke', 'gray');
        }, false);
                
        quantTools.appendChild(button);
        this.makeQuantConfigButton(quantTools, tier, 0);
        this.makeTooltip(quantTools, 'Click to adjust how this data is displayed');
    }

    var labelMaxWidth = this.tabMargin - 20;
    if (hasWidget) {
        labelMaxWidth -= 20;
    }
    var labelString = tier.dasSource.name;
    var labelText = document.createElementNS(NS_SVG, 'text');
    labelText.setAttribute('x', 15);
    labelText.setAttribute('y', 17);
    labelText.setAttribute('stroke-width', 0);
    labelText.setAttribute('fill', 'black');
    labelText.appendChild(document.createTextNode(labelString));
    labelText.setAttribute('pointer-events', 'none');
    labelGroup.appendChild(labelText);

    while (labelText.getBBox().width > labelMaxWidth) {
        removeChildren(labelText);
        labelString = labelString.substring(0, labelString.length - 1);
        labelText.appendChild(document.createTextNode(labelString + '...'));
    }
    return labelGroup;
}

Browser.prototype.arrangeTiers = function() {
    var browserSvg = this.svgRoot;
    for (var p = 0; p < this.placards.length; ++p) {
	browserSvg.removeChild(this.placards[p]);
    }
    this.placards = [];

    var labelGroup = this.dasLabelHolder;
	
    var clh = 50;
    for (ti = 0; ti < this.tiers.length; ++ti) {
	var tier = this.tiers[ti];
	tier.y = clh;
        
        if (!tier.isLabelValid) {
            if (tier.label) {
                labelGroup.removeChild(tier.label);
            }
            tier.label = makeElementNS(NS_SVG, 'g');
            labelGroup.appendChild(tier.label);
            this.labelForTier(tier, ti, tier.label);
        }

	this.xfrmTier(tier, this.tabMargin - ((1.0 * (this.viewStart - this.origin)) * this.scale), -1);
	    
	if (tier.placard) {
	    tier.placard.setAttribute('transform', 'translate(' + this.tabMargin + ', ' + (clh + tier.layoutHeight - 4) + ')');
	    browserSvg.appendChild(tier.placard);
	    this.placards.push(tier.placard);
	}

	clh += tier.layoutHeight;
    }
	
    this.featureBackground.setAttribute('height', ((clh | 0) - 50));

    if (clh < 150) {
	clh = 150;
    }
	
    if (this.browserFrameHeight != clh) {
        this.svgRoot.setAttribute("height", "" + ((clh | 0) + 10) + "px");
        this.svgBackground.setAttribute("height", "" + ((clh | 0) + 10));
        this.featureClipRect.setAttribute("height", "" + ((clh | 0) - 10));
        this.labelClipRect.setAttribute("height", "" + ((clh | 0) - 10));
        this.browserFrameHeight = clh;
    }
}

Browser.prototype.offsetForTier = function(ti) {
    var clh = 50;
    for (var t = 0; t < ti; ++t) {
        clh += this.tiers[t].layoutHeight;
    }
    return clh;
}

Browser.prototype.tierInfoPopup = function(tier, ev) {
    var regel;

    var popcontents = [];
    if (tier.dasSource.desc) {
        popcontents.push(tier.dasSource.desc);
    }

    var srcs = this.availableSources.get();
    if (tier.dasSource.mapping) {
        var mcs = this.chains[tier.dasSource.mapping].coords;
        popcontents.push(makeElement('p', makeElement('i', 'Mapped from ' + mcs.auth + mcs.version)));
        srcs = this.mappableSources[tier.dasSource.mapping].get();
    }

    if (!srcs || srcs == 0) {
        regel = makeElement('p', 'Registry data not available');
    } else {
        for (var ri = 0; ri < srcs.length; ++ri) {
            var re = srcs[ri];
            if (re.uri == tier.dasSource.uri && re.source_uri) {
                regel = makeElement('p', makeElement('a', 'Registry entry: ' + re.name, {href: 'http://www.dasregistry.org/showdetails.jsp?auto_id=' + re.source_uri, target: '_new'})); 
                break;
            }
        }
        if (!regel) {
            regel = makeElement('p', 'No registry information for this source');
        }
    }

    popcontents.push(regel);

    this.popit(ev, tier.dasSource.name, popcontents, {width: 300});
}

Browser.prototype.setupTierDrag = function(element, ti) {
    var thisB = this;
    var dragOriginX, dragOriginY;
    var dragFeedbackRect;
    var targetTier;
    var clickTimeout = null;
    var tier = this.tiers[ti];
    
    var moveHandler = function(ev) {
        var cly = ((ev.clientY + window.scrollY - dragOriginY) | 0) - 50;
        var destTier = 0;
        while (destTier < thisB.tiers.length && cly > thisB.tiers[destTier].layoutHeight) {
            cly -= thisB.tiers[destTier].layoutHeight;
            ++destTier;
        }
        if (destTier != targetTier) {
            targetTier = destTier;
            dragFeedbackRect.setAttribute('y', thisB.offsetForTier(targetTier) - 2);
        }
    };
    
    var binned = false;
    var binEnterHandler = function(ev) {
        thisB.bin.setAttribute('stroke', 'red');
        dragFeedbackRect.setAttribute('fill', 'none');
        binned = true;
    }
    var binLeaveHandler = function(ev) {
        thisB.bin.setAttribute('stroke', 'gray');
        dragFeedbackRect.setAttribute('fill', 'red');
        binned = false;
    }
    
    var upHandler = function(ev) {
        window.removeEventListener('mousemove', moveHandler, true);
        window.removeEventListener('mouseup', upHandler, true);
        thisB.bin.removeEventListener('mouseover', binEnterHandler, true);
        thisB.bin.removeEventListener('mouseout', binLeaveHandler, true);
        thisB.bin.setAttribute('stroke', 'gray');

        if (clickTimeout) {
            clearTimeout(clickTimeout);
            clickTimeout = null;
            thisB.tierInfoPopup(tier, ev);
            return;
        }

        thisB.popupHolder.removeChild(dragFeedbackRect);
        if (binned) {
            thisB.removeTier(thisB.tiers[ti]);
        } else if (targetTier == ti) {
            // Nothing at all.
        } else {
            var newTiers = [];
            
            var fromCnt = 0;
            if (targetTier > ti) {
                --targetTier;
            }
            while (newTiers.length < thisB.tiers.length) {
                if (newTiers.length == targetTier) {
                    newTiers.push(thisB.tiers[ti]);
                } else {
                    if (fromCnt != ti) {
                        newTiers.push(thisB.tiers[fromCnt]);
                    }
                    ++fromCnt;
                }
            }
            
            thisB.tiers = newTiers;
            if (thisB.knownSpace) {
                thisB.knownSpace.tierMap = thisB.tiers;
            }
            for (var nti = 0; nti < thisB.tiers.length; ++nti) {
                thisB.tiers[nti].background.setAttribute("fill", thisB.tierBackgroundColors[nti % thisB.tierBackgroundColors.length]);
                thisB.tiers[nti].isLabelValid = false;
            }
            
            thisB.arrangeTiers();
	    thisB.storeStatus();
        }
    }
    
    element.addEventListener('mousedown', function(ev) {
        thisB.removeAllPopups();
        ev.stopPropagation();ev.preventDefault();
        
        var origin = thisB.svgHolder.getBoundingClientRect();
        dragOriginX = origin.left + window.scrollX;dragOriginY = origin.top + window.scrollY;
        window.addEventListener('mousemove', moveHandler, true);
        window.addEventListener('mouseup', upHandler, true);
        thisB.bin.addEventListener('mouseover', binEnterHandler, true);
        thisB.bin.addEventListener('mouseout', binLeaveHandler, true);
        targetTier = ti;
        dragFeedbackRect = makeElementNS(NS_SVG, 'rect', null, {
            x: thisB.tabMargin,
            y: thisB.offsetForTier(targetTier) - 2,
            width: thisB.featurePanelWidth,
            height: 4,
            fill: 'red',
            stroke: 'none'
        });
        
        clickTimeout = setTimeout(function() {
            clickTimeout = null;
            // We can do all the setup on click, but don't show the feedback rectangle
            // until we're sure it's a click rather than a drag.
            thisB.popupHolder.appendChild(dragFeedbackRect);
        }, 200);

    },true);
}

Browser.prototype.makeToggleButton = function(labelGroup, tier, ypos) {
    var thisB = this;
    var bumpToggle = makeElementNS(NS_SVG, 'g', null, {fill: 'cornsilk', strokeWidth: 1, stroke: 'gray'});
    bumpToggle.appendChild(makeElementNS(NS_SVG, 'rect', null, {x: this.tabMargin - 15, y: ypos + 8, width: 8, height: 8}));
    bumpToggle.appendChild(makeElementNS(NS_SVG, 'line', null, {x1: this.tabMargin - 15, y1: ypos + 12, x2: this.tabMargin - 7, y2: ypos+12}));
    if (!tier.bumped) {
        bumpToggle.appendChild(makeElementNS(NS_SVG, 'line', null, {x1: this.tabMargin - 11, y1: ypos+8, x2: this.tabMargin - 11, y2: ypos+16}));
    }
    labelGroup.appendChild(bumpToggle);
    bumpToggle.addEventListener('mouseover', function(ev) {bumpToggle.setAttribute('stroke', 'red');}, false);
    bumpToggle.addEventListener('mouseout', function(ev) {
        bumpToggle.setAttribute('stroke', 'gray');
    }, false);
    bumpToggle.addEventListener('mousedown', function(ev) {
	tier.bumped = !tier.bumped;
        tier.layoutWasDone = false;   // permits the feature-tier layout code to resize the tier.
        tier.isLabelValid = false;
	tier.draw();
    }, false);
    this.makeTooltip(bumpToggle, 'Click to ' + (tier.bumped ? 'collapse' : 'expand'));
}

Browser.prototype.updateRegion = function() {
    if (this.updateRegionBaton) {
        // dlog('UR already pending');
    } else {
        var thisB = this;
        this.updateRegionBaton = setTimeout(function() {
            thisB.updateRegionBaton = null;
            thisB.realUpdateRegion();
        }, 25);
    }
}

Browser.prototype.realUpdateRegion = function()
{
    var chrLabel = this.chr;
    if (chrLabel.indexOf('chr') < 0) {
        chrLabel = 'chr' + chrLabel;
    }
    var fullLabel = chrLabel + ':' + (this.viewStart|0) + '..' + (this.viewEnd|0);

    removeChildren(this.regionLabel);
    this.regionLabel.appendChild(document.createTextNode(fullLabel));
    var bb = this.regionLabel.getBBox();
    var rlm = bb.x + bb.width;
    if (this.regionLabelMax && rlm > this.regionLabelMax) {
        removeChildren(this.regionLabel);
        this.regionLabel.appendChild(document.createTextNode(chrLabel));
    }
}

Browser.prototype.refresh = function() {
    var width = (this.viewEnd - this.viewStart) + 1;
    var minExtraW = (width * this.minExtra) | 0;
    var maxExtraW = (width * this.maxExtra) | 0;

    
    var newOrigin = (this.viewStart + this.viewEnd) / 2;
    var oh = newOrigin - this.origin;
    this.origin = newOrigin;
    this.scaleAtLastRedraw = this.scale;
    for (var t = 0; t < this.tiers.length; ++t) {
        var od = oh;
	if (this.tiers[t].originHaxx) {
	    od += this.tiers[t].originHaxx;
	}
	this.tiers[t].originHaxx = od;
    }

    var scaledQuantRes = this.targetQuantRes / this.scale;


    var innerDrawnStart = Math.max(1, (this.viewStart|0) - minExtraW);
    var innerDrawnEnd = Math.min((this.viewEnd|0) + minExtraW, ((this.currentSeqMax|0) > 0 ? (this.currentSeqMax|0) : 1000000000))
    var outerDrawnStart = Math.max(1, (this.viewStart|0) - maxExtraW);
    var outerDrawnEnd = Math.min((this.viewEnd|0) + maxExtraW, ((this.currentSeqMax|0) > 0 ? (this.currentSeqMax|0) : 1000000000));

    if (!this.knownSpace || this.knownSpace.chr !== this.chr) {
        var ss = null;
        for (var i = 0; i < this.tiers.length; ++i) {
            if (this.tiers[i].sequenceSource) {
                ss = this.tiers[i].sequenceSource;
                break;
            }
        }
        this.knownSpace = new KnownSpace(this.tiers, this.chr, outerDrawnStart, outerDrawnEnd, scaledQuantRes, ss);
    }
    
    var seg = this.knownSpace.bestCacheOverlapping(this.chr, innerDrawnStart, innerDrawnEnd);
    if (seg && seg.min <= innerDrawnStart && seg.max >= innerDrawnEnd) {
        this.drawnStart = Math.max(seg.min, outerDrawnStart);
        this.drawnEnd = Math.min(seg.max, outerDrawnEnd);
    } else {
        this.drawnStart = outerDrawnStart;
        this.drawnEnd = outerDrawnEnd;
    }

    this.knownSpace.viewFeatures(this.chr, this.drawnStart, this.drawnEnd, scaledQuantRes);
}


// var originX;
// var dcTimeoutID = null;
// var clickTestTB = null;

Browser.prototype.mouseDownHandler = function(ev)
{
    var thisB = this;
    this.removeAllPopups();
    ev.stopPropagation();ev.preventDefault();

    var target = document.elementFromPoint(ev.clientX, ev.clientY);
    while (target && !target.dalliance_feature && !target.dalliance_group) {
        target = target.parentNode;
    }

    if (target && (target.dalliance_feature || target.dalliance_group)) {
	if (this.dcTimeoutID && target.dalliance_feature) {
            var f = target.dalliance_feature;
            var org = this.svgHolder.getBoundingClientRect();
            var fstart = (((f.min|0) - (this.viewStart|0)) * this.scale) + org.left + this.tabMargin;
            var fwidth = (((f.max - f.min) + 1) * this.scale);

	    clearTimeout(this.dcTimeoutID);
	    this.dcTimeoutID = null;

            var newMid = (((target.dalliance_feature.min|0) + (target.dalliance_feature.max|0)))/2;
            if (fwidth > 10) {
                var frac = (1.0 * (ev.clientX - fstart)) / fwidth;
                if (frac < 0.3) {
                    newMid = (target.dalliance_feature.min|0);
                } else  if (frac > 0.7) {
                    newMid = (target.dalliance_feature.max|0) + 1;
                }
            }

	    var width = this.viewEnd - this.viewStart;
	    this.setLocation(newMid - (width/2), newMid + (width/2));
            
            var extraPix = this.featurePanelWidth - ((width+1)*this.scale);
            // alert(extraPix);
            if (Math.abs(extraPix) > 1) {
                this.move(extraPix/2);
            }
	} else {
	    this.dcTimeoutID = setTimeout(function() {
		thisB.dcTimeoutID = null;
		thisB.featurePopup(ev, target.dalliance_feature, target.dalliance_group);
	    }, 200);
	}
    } else {
	this.originX = ev.clientX;
	document.addEventListener('mousemove', this.__mouseMoveHandler, true);
	document.addEventListener('mouseup', this.__mouseUpHandler, true);
        this.clickTestTB = setTimeout(function() {
            thisB.clickTestTB = null;
        }, 200);
    }
}


var TAGVAL_NOTE_RE = new RegExp('^([A-Za-z]+)=(.+)');

Browser.prototype.featurePopup = function(ev, feature, group){
    //console.log('featurePopup called blah');
    if (!feature) feature = {};
    if (!group) group = {};

    this.removeAllPopups();

    var table = makeElement('table', null);
    table.style.width = '100%';

    var name = pick(group.type, feature.type);
    //console.log('name='+name);
    var fid = pick(feature.label,group.label, group.id, feature.id);
    //console.log('featureId='+feature.id);
    if (fid && fid.indexOf('__dazzle') != 0) {
        name = name + ': ' + fid;
    }

    var idx = 0;
    if (feature.method) {
        var row = makeElement('tr', [
            makeElement('th', 'Method'),
            makeElement('td', feature.method)
        ]);
        row.style.backgroundColor = this.tierBackgroundColors[idx % this.tierBackgroundColors.length];
        table.appendChild(row);
        ++idx;
    }
    {
        var loc;
        if (group.segment) {
            loc = group;
        } else {
            loc = feature;
        }
        var row = makeElement('tr', [
            makeElement('th', 'Location'),
            makeElement('td', loc.segment + ':' + loc.min + '-' + loc.max)
        ]);
        row.style.backgroundColor = this.tierBackgroundColors[idx % this.tierBackgroundColors.length];
        table.appendChild(row);
        ++idx;
    }
    if (feature.score !== undefined && feature.score !== null && feature.score != '-') {
        var row = makeElement('tr', [
            makeElement('th', 'Score'),
            makeElement('td', '' + feature.score)
        ]);
        row.style.backgroundColor = this.tierBackgroundColors[idx % this.tierBackgroundColors.length];
        table.appendChild(row);
        ++idx;
    }
    {
        var links = maybeConcat(group.links, feature.links);
        //console.debug(links);
        
        
        if (links && links.length > 0) {  
            var row = makeElement('tr', [
                makeElement('th', 'Links'),
                makeElement('td', links.map(function(l) {
                    //<img src="url" alt="some_text"/>
                if(l.desc=='Cassette Image'){
                   // console.debug(l.desc);
                return makeElement('div',makeElement('a', makeElement('img', l.desc, {width:320, src: l.uri}), {href:l.uri, target: '_new'}));//'<img src="http://www.knockoutmouse.org/targ_rep/alleles/37256/allele-image" alt="some_text"/>');
                }
                //if not image do something else here
                return makeElement('div', makeElement('a', l.desc, {href: l.uri, target: '_new'}));
                }))
            ]);
            row.style.backgroundColor = this.tierBackgroundColors[idx % this.tierBackgroundColors.length];
            table.appendChild(row);
            
            ++idx;
        }
    }
    {
        var notes = maybeConcat(group.notes, feature.notes);
        for (var ni = 0; ni < notes.length; ++ni) {
            var k = 'Note';
            var v = notes[ni];
            var m = v.match(TAGVAL_NOTE_RE);
            if (m) {
                k = m[1];
                v = m[2];
            }

            var row = makeElement('tr', [
                makeElement('th', k),
                makeElement('td', v)
            ]);
            row.style.backgroundColor = this.tierBackgroundColors[idx % this.tierBackgroundColors.length];
            table.appendChild(row);
            ++idx;
        }
    }

    this.popit(ev, name, table, {width: 400});
}

Browser.prototype.mouseUpHandler = function(ev) {
    var thisB = this;

    if (this.clickTestTB && this.positionFeedback) {
        var origin = svgHolder.getBoundingClientRect();
        var ppos = ev.clientX - origin.left - this.tabMargin;
        var spos = (((1.0*ppos)/this.scale) + this.viewStart)|0;
        
        var mx = ev.clientX + window.scrollX, my = ev.clientY + window.scrollY;
        var popup = makeElement('div', '' + spos, {}, {
            position: 'absolute',
            top: '' + (my + 20) + 'px',
            left: '' + Math.max(mx - 30, 20) + 'px',
            backgroundColor: 'rgb(250, 240, 220)',
            borderWidth: '1px',
            borderColor: 'black',
            borderStyle: 'solid',
            padding: '2px',
            maxWidth: '400px'
        });
        this.hPopupHolder.appendChild(popup);
        var moveHandler;
        moveHandler = function(ev) {
            try {
                thisB.hPopupHolder.removeChild(popup);
            } catch (e) {
                // May have been removed by other code which clears the popup layer.
            }
            window.removeEventListener('mousemove', moveHandler, false);
        }
        window.addEventListener('mousemove', moveHandler, false);
    }
    
    ev.stopPropagation();ev.preventDefault();

    document.removeEventListener('mousemove', this.__mouseMoveHandler, true);
    document.removeEventListener('mouseup', this.__mouseUpHandler, true);
    this.storeStatus();
}

Browser.prototype.mouseMoveHandler = function(ev) {
    ev.stopPropagation();ev.preventDefault();
    if (ev.clientX != this.originX) {
        this.move(ev.clientX - this.originX);
        this.originX = ev.clientX;
    }
}

/*

var touchOriginX;

function touchStartHandler(ev)
{
    removeAllPopups();
    ev.stopPropagation(); ev.preventDefault();
    
    touchOriginX = ev.touches[0].pageX;
}

function touchMoveHandler(ev)
{
    ev.stopPropagation(); ev.preventDefault();
    
    var touchX = ev.touches[0].pageX;
    if (touchX != touchOriginX) {
	move(touchX - touchOriginX);
	touchOriginX = touchX;
    }
}

function touchEndHandler(ev)
{
    ev.stopPropagation(); ev.preventDefault();
    storeStatus();
}

function touchCancelHandler(ev) {
}

*/


Browser.prototype.removeAllPopups = function() {
    removeChildren(this.popupHolder);
    removeChildren(this.hPopupHolder);
}

function EPMenuItem(entryPoint) {
    this.entryPoint = entryPoint;
    this.nums = stringToNumbersArray(entryPoint.name);
}

Browser.prototype.makeHighlight = function() {
    if (this.highlight) {
	this.dasTierHolder.removeChild(this.highlight);
	this.highlight = null;
    }

    if (this.highlightMin > 0) {
	this.highlight = document.createElementNS(NS_SVG, 'rect');
	this.highlight.setAttribute('x', (this.highlightMin - this.origin) * this.scale);
	this.highlight.setAttribute('y', 0);
	this.highlight.setAttribute('width', (this.highlightMax - this.highlightMin + 1) * this.scale);
	this.highlight.setAttribute('height', 10000);
	this.highlight.setAttribute('stroke', 'none');
	this.highlight.setAttribute('fill', 'red');
	this.highlight.setAttribute('fill-opacity', 0.15);
	this.highlight.setAttribute('pointer-events', 'none');
	this.dasTierHolder.appendChild(this.highlight);
    }
}

Browser.prototype.init = function() {
    // Just here for backwards compatibility.
}

Browser.prototype.realInit = function(opts) {
    if (!opts) {
        opts = {};
    }
    this.supportsBinary = (typeof Int8Array === 'function');
    // dlog('supports binary: ' + this.supportsBinary);

    var thisB = this;
    // Cache away the default sources before anything else

    this.defaultSources = [];
    for (var i = 0; i < this.sources.length; ++i) {
        this.defaultSources.push(this.sources[i]);
    }
    this.defaultChr = this.chr;
    this.defaultStart = this.viewStart;
    this.defaultEnd = this.viewEnd;

    this.icons = new IconSet(this.iconsURI);

    var overrideSources;
    var reset = false;
    var qChr = null, qMin = null, qMax = null;
    
    //
    // Configuration processing
    //

    var queryDict = {};
    if (location.search) {
        var query = location.search.substring(1);
        var queries = query.split(new RegExp('[&;]'));
        for (var qi = 0; qi < queries.length; ++qi) {
            var kv = queries[qi].split('=');
            var k = decodeURIComponent(kv[0]), v=null;
            if (kv.length > 1) {
                v = decodeURIComponent(kv[1]);
            }
            queryDict[k] = v;
        }
        
        reset = queryDict.reset;
    }

    var storedConfigVersion = localStorage['dalliance.' + this.cookieKey + '.version'];
    if (storedConfigVersion) {
        storedConfigVersion = storedConfigVersion|0;
    } else {
        storedConfigVersion = -100;
    }
    if (VERSION.CONFIG != storedConfigVersion) {
//        dlog("Don't understand config version " + storedConfigVersion + ", resetting.");
        reset = true;
    }

    var storedConfigHash = localStorage['dalliance.' + this.cookieKey + '.configHash'] || '';
    var pageConfigHash = hex_sha1(miniJSONify(this.sources));   // okay to switch this to "real" JSON?
    if (pageConfigHash != storedConfigHash) {
//        alert('page config seems to have changed, resetting');
        reset=true;
        localStorage['dalliance.' + this.cookieKey + '.configHash'] = pageConfigHash;
    }

    if (this.cookieKey && localStorage['dalliance.' + this.cookieKey + '.view-chr'] && !reset) {
        qChr = localStorage['dalliance.' + this.cookieKey + '.view-chr'];
        qMin = localStorage['dalliance.' + this.cookieKey + '.view-start']|0;
        qMax = localStorage['dalliance.' + this.cookieKey + '.view-end']|0;
    }

    if (this.cookieKey) {
	var maybeSourceConfig = localStorage['dalliance.' + this.cookieKey + '.sources'];
	if (maybeSourceConfig && !reset) {
	    overrideSources = JSON.parse(maybeSourceConfig);
	}
    }
    
    var region_exp = /([\d+,\w,\.,\_,\-]+):(\d+)[\-,\,](\d+)/;

    var queryRegion = false;
    if (queryDict.chr) {
	var qChr = queryDict.chr;
	var qMin = queryDict.min;
	var qMax = queryDict.max;
	queryRegion = true;
    }

    this.positionFeedback = queryDict.positionFeedback || false;
    guidelineConfig = queryDict.guidelines || 'foreground';
    if (guidelineConfig == 'true') {
	this.guidelineStyle = 'background';
    } else if (STRICT_NUM_REGEXP.test(guidelineConfig)) {
	this.guidelineStyle = 'background';
	this.guidelineSpacing = guidelineConfig|0;
    } else {
	this.guidelineStyle = guidelineConfig;
    }

    if (!queryRegion) {
	regstr = queryDict.r;
	if (!regstr) {
	    regstr = queryDict.segment || '';
	}
	var match = regstr.match(region_exp);
	if ((regstr != '') && match) {
	    qChr = match[1];
	    qMin = match[2] | 0;
	    qMax = match[3] | 0;
	}
	queryRegion = true;
    }
	
    if (qMax < qMin) {
	qMax = qMin + 10000;
    }

    var histr = queryDict.h || '';
    var match = histr.match(region_exp);
    if (match) {
	this.highlightMin = match[2]|0;
	this.highlightMax = match[3]|0;
    }

    //
    // Set up the UI (factor out?)
    //
           
    this.svgHolder = document.getElementById(this.pageName);
    this.svgRoot = makeElementNS(NS_SVG, 'svg', null, {
        version: '1.1',
        width: '860px',
        height: '500px',
        id: 'browser_svg'
    });
    removeChildren(this.svgHolder);
    this.svgHolder.appendChild(this.svgRoot);

    {
        var patdata = '';
         for (var i = -90; i <= 90; i += 20) {
             patdata = patdata + 'M ' + (Math.max(0, i) - 2) + ' ' + (Math.max(-i, 0) - 2) + ' L ' + (Math.min(100 + i, 100) + 2) + ' ' + (Math.min(100 - i, 100) + 2) + ' ';
             patdata = patdata + 'M ' + Math.max(i, 0) + ' ' + Math.min(i + 100, 100) + ' L ' + Math.min(i + 100, 100) + ' ' + Math.max(i, 0) + ' ';
        }
        var pat =  makeElementNS(NS_SVG, 'pattern',
                                 makeElementNS(NS_SVG, 'path', null, {
                                     stroke: 'lightgray',
                                     strokeWidth: 2,
                                     d: patdata
                                     // d: 'M 0 90 L 10 100 M 0 70 L 30 100 M 0 50 L 50 100 M 0 30 L 70 100 M 0 10 L 90 100 M 10 0 L 100 90 M 30 0 L 100 70 M 50 0 L 100 50 M 70 0 L 100 30 M 90 0 L 100 10'
                                     // 'M 0 90 L 90 0 M 0 70 L 70 0'
                                 }),
                                 {
                                     id: 'bgpattern-' + this.pageName,
                                     x: 0,
                                     y: 0,
                                     width: 100,
                                     height: 100
                                 });
        pat.setAttribute('patternUnits', 'userSpaceOnUse');
        this.svgRoot.appendChild(pat);
    }

    this.svgBackground = makeElementNS(NS_SVG, 'rect', null,  {id: 'background', fill: 'white' /*'url(#bgpattern-' + this.pageName + ')' */});
    var main = makeElementNS(NS_SVG, 'g', this.svgBackground, {
        fillOpacity: 1.0, 
        stroke: 'black', 
        strokeWidth: '0.1cm', 
        fontFamily: 'helvetica', 
        fontSize: '10pt'
    });
    this.svgRoot.appendChild(main);

    this.regionLabel = makeElementNS(NS_SVG, 'text', 'chr???', {
        x: 260,
        y: 30,
        strokeWidth: 0
    });
    main.appendChild(this.regionLabel);
    this.makeTooltip(this.regionLabel, 'Click to jump to a new location or gene');

    var addButton = this.icons.createButton('add-track', main, 30, 30);
    addButton.setAttribute('transform', 'translate(100, 10)');
    this.makeTooltip(addButton, 'Add tracks from the DAS registry');
    main.appendChild(addButton);

    var linkButton = this.icons.createButton('link', main, 30, 30);
    linkButton.setAttribute('transform', 'translate(140, 10)');
    this.makeTooltip(linkButton, 'Follow links to other genome browsers');
    main.appendChild(linkButton);

    var resetButton = this.icons.createButton('reset', main, 30, 30);
    resetButton.setAttribute('transform', 'translate(180, 10)');
    this.makeTooltip(resetButton, 'Reset the browser to a default state');
    main.appendChild(resetButton);

    var saveButton = this.icons.createButton('export', main, 30, 30);
    saveButton.setAttribute('transform', 'translate(220, 10)');
    this.makeTooltip(saveButton, 'Export the current genome display as a vector graphics file');
    main.appendChild(saveButton);
    var savePopupHandle;
    saveButton.addEventListener('mousedown', function(ev) {
        ev.stopPropagation();ev.preventDefault();
        var showing = savePopupHandle && savePopupHandle.displayed;
        thisB.removeAllPopups();
        
        if (showing) {
            return;
        }

        var saveDoc = document.implementation.createDocument(NS_SVG, 'svg', null);
        var saveWidth = thisB.svgRoot.getAttribute('width')|0;
        saveDoc.documentElement.setAttribute('width', saveWidth);
        saveDoc.documentElement.setAttribute('height', thisB.svgRoot.getAttribute('height'));

        var saveRoot = makeElementNS(NS_SVG, 'g', null, {
            fontFamily: 'helvetica'
        });
        saveDoc.documentElement.appendChild(saveRoot);
        var dallianceAnchor = makeElementNS(NS_SVG, 'text', 'Graphics from Dalliance ' + VERSION, {
                x: 80,
                y: 30,
                strokeWidth: 0,
                fill: 'black',
                fontSize: '12pt'
        });
        thisB.svgRoot.appendChild(dallianceAnchor);
        var daWidth = dallianceAnchor.getBBox().width;
        thisB.svgRoot.removeChild(dallianceAnchor);
        dallianceAnchor.setAttribute('x', saveWidth - daWidth - 60);
        saveRoot.appendChild(dallianceAnchor);
        // dallianceAnchor.setAttributeNS(NS_XLINK, 'xlink:href', 'http://www.biodalliance.org/');
        
        var chrLabel = thisB.chr;
        if (chrLabel.indexOf('chr') < 0) {
            chrLabel = 'chr' + chrLabel;
        }
        var fullLabel = chrLabel + ':' + (thisB.viewStart|0) + '..' + (thisB.viewEnd|0);
        saveRoot.appendChild(makeElementNS(NS_SVG, 'text', fullLabel, {
            x: 40,
            y: 30,
            strokeWidth: 0,
            fill: 'black',
            fontSize: '12pt'
        })); 

        saveRoot.appendChild(labelClip.cloneNode(true));
        saveRoot.appendChild(thisB.dasLabelHolder.cloneNode(true));
        saveRoot.appendChild(featureClip.cloneNode(true));
        saveRoot.appendChild(thisB.dasTierHolder.cloneNode(true));

        var svgButton = makeElement('input', null, {
            type: 'radio',
            name: 'format',
            value: 'svg',
            checked: true
        });
        var pdfButton = makeElement('input', null, {
            type: 'radio',
            name: 'format',
            value: 'pdf'
        });
        var saveForm = makeElement('form', [makeElement('p', "To work around restrictions on saving files from web applications, image export currently requires transmission of the browser's current state to a remote server.  Depending on connection speed, this can take a few seconds -- please be patient."),
                                            makeElement('p', 'The download links only work once, so if you wish to keep or share your exported images, please save a copy on your computer'),
                                            svgButton, 'SVG', makeElement('br'),
                                            pdfButton, 'PDF', makeElement('br'),
                                            makeElement('br'),
                                            makeElement('input', null, {type: 'hidden',  name: 'svgdata', value: new XMLSerializer().serializeToString(saveDoc)}),
                                            makeElement('input', null, {type: 'submit'})],
                                   {action: thisB.exportServer + 'browser-image.svg', method: 'POST'});
        svgButton.addEventListener('click', function(cev) {
            saveForm.setAttribute('action', thisB.exportServer + 'browser-image.svg');
        }, false);
        pdfButton.addEventListener('click', function(cev) {
            saveForm.setAttribute('action', thisB.exportServer + 'browser-image.pdf');
        }, false);
        saveForm.addEventListener('submit', function(sev) {
            setTimeout(function() {
                thisB.removeAllPopups();
            }, 200);
            return true;
        }, false);
        savePopupHandle = thisB.popit(ev, 'Export', saveForm, {width: 400});
    }, false);

    this.bin = this.icons.createIcon('bin', main);
    this.bin.setAttribute('transform', 'translate(10, 18)');
    main.appendChild(this.bin);
    this.makeTooltip(this.bin, 'Drag tracks here to discard');
    
    this.featureClipRect = makeElementNS(NS_SVG, 'rect', null, {
        x: this.tabMargin,
        y: 50,
        width: 850 - this.tabMargin,
        height: 440
    });
    var featureClip = makeElementNS(NS_SVG, 'clipPath', this.featureClipRect, {id: 'featureClip-' + this.pageName});
    main.appendChild(featureClip);
    this.labelClipRect = makeElementNS(NS_SVG, 'rect', null, {
        x: 10,
        y: 50,
        width: this.tabMargin - 10,
        height: 440
    });
    var labelClip = makeElementNS(NS_SVG, 'clipPath', this.labelClipRect, {id: 'labelClip-' + this.pageName});
    main.appendChild(labelClip);
    
    this.featureBackground = makeElementNS(NS_SVG, 'rect', null, {
        x: this.tabMargin,
        y: 50,
        width: 850 - this.tabMargin,
        height: 440,
        stroke: 'none',
        fill: 'url(#bgpattern-' + this.pageName + ')'
    });
    main.appendChild(this.featureBackground);

    this.dasTierHolder = makeElementNS(NS_SVG, 'g', null, {clipPath: 'url(#featureClip-' + this.pageName + ')'});   // FIXME needs a unique ID.
    main.appendChild(this.dasTierHolder);
    var dasTiers = makeElementNS(NS_SVG, 'g', null, {id: 'dasTiers'});
    this.dasTierHolder.appendChild(dasTiers);

    this.makeHighlight();
    
    this.dasLabelHolder = makeElementNS(NS_SVG, 'g', makeElementNS(NS_SVG, 'g', null, {id: 'dasLabels'}), {clipPath: 'url(#labelClip-' + this.pageName + ')'}); 
    main.appendChild(this.dasLabelHolder);
    
    {
        var plusIcon = this.icons.createIcon('magnifier-plus', main);
        var minusIcon = this.icons.createIcon('magnifier-minus', main);
        this.zoomTickMarks = makeElementNS(NS_SVG, 'g');
        this.zoomSlider = new DSlider(250);
        this.zoomSlider.onchange = function(zoomVal, released) {
	    thisB.zoom(Math.exp((1.0 * zoomVal) / thisB.zoomExpt));
	    if (released) {
                thisB.invalidateLayouts();
	        thisB.refresh();
	        thisB.storeStatus();
	    }
        };
        plusIcon.setAttribute('transform', 'translate(0,15)');
        plusIcon.setAttribute('pointer-events', 'all');
        plusIcon.addEventListener('mousedown', function(ev) {
            ev.stopPropagation();ev.preventDefault();

            var oz = thisB.zoomSlider.getValue();
            thisB.zoomSlider.setValue(oz - 10);
            var nz = thisB.zoomSlider.getValue();
            if (nz != oz) {
                thisB.zoom(Math.exp((1.0 * nz) / thisB.zoomExpt));
                thisB.scheduleRefresh(500);
            }
        }, false);
        this.zoomSlider.svg.setAttribute('transform', 'translate(30, 0)');
        minusIcon.setAttribute('transform', 'translate(285,15)');
        minusIcon.setAttribute('pointer-events', 'all');
        minusIcon.addEventListener('mousedown', function(ev) {
            ev.stopPropagation();ev.preventDefault();

            var oz = thisB.zoomSlider.getValue();
            thisB.zoomSlider.setValue(oz + 10);
            var nz = thisB.zoomSlider.getValue();
            if (nz != oz) {
                thisB.zoom(Math.exp((1.0 * nz) / thisB.zoomExpt));
                thisB.scheduleRefresh(500);
            }
        }, false);
        this.zoomWidget = makeElementNS(NS_SVG, 'g', [this.zoomTickMarks, plusIcon, this.zoomSlider.svg, minusIcon]);

        this.makeTooltip(this.zoomWidget, 'Drag to zoom');
        main.appendChild(this.zoomWidget);
    }

    this.karyo = new Karyoscape(this, this.karyoEndpoint);
    this.karyo.svg.setAttribute('transform', 'translate(480, 15)');
    this.karyo.onchange = function(pos) {
        var width = thisB.viewEnd - thisB.viewStart + 1;
        var newStart = ((pos * thisB.currentSeqMax) - (width/2))|0;
        var newEnd = newStart + width - 1;
        thisB.setLocation(newStart, newEnd);
    };
    main.appendChild(this.karyo.svg);
    
    this.popupHolder = makeElementNS(NS_SVG, 'g');
    main.appendChild(this.popupHolder);
    this.hPopupHolder = makeElement('div');
    this.hPopupHolder.style['font-family'] = 'helvetica';
    this.hPopupHolder.style['font-size'] = '12pt';
    this.svgHolder.appendChild(this.hPopupHolder);
  
    this.bhtmlRoot = makeElement('div');
    if (!this.disablePoweredBy) {
        this.bhtmlRoot.appendChild(makeElement('span', ['Powered by ', makeElement('a', 'Dalliance', {href: 'http://www.biodalliance.org/'}), ' ' + VERSION]));
    }
    this.svgHolder.appendChild(this.bhtmlRoot);
    
    if (this.guidelineStyle == 'foreground') {
	this.fgGuide = document.createElementNS(NS_SVG, 'line');
	this.fgGuide.setAttribute('x1', 500);
	this.fgGuide.setAttribute('y1', 50);
	this.fgGuide.setAttribute('x2', 500);
	this.fgGuide.setAttribute('y2', 10000);
	this.fgGuide.setAttribute('stroke', 'red');
	this.fgGuide.setAttribute('stroke-width', 1);
	this.fgGuide.setAttribute('pointer-events', 'none');
	main.appendChild(this.fgGuide);
    }
    
    // set up the linker

    var linkPopupHandle;
    linkButton.addEventListener('mousedown', function(ev) {
        var showing = linkPopupHandle && linkPopupHandle.displayed;
        ev.stopPropagation();ev.preventDefault();
	thisB.removeAllPopups();
        if (showing) {
            return;
        }

        var linkList = makeElement('ul');
        for (l in thisB.browserLinks) {
            linkList.appendChild(makeElement('li', makeElement('a', l, {
                href: thisB.browserLinks[l].replace(new RegExp('\\${([a-z]+)}', 'g'), function(s, p1) {
		    if (p1 == 'chr') {
		        return thisB.chr;
		    } else if (p1 == 'start') {
		        return thisB.viewStart|0;
		    } else if (p1 == 'end') {
		        return thisB.viewEnd|0;
		    } else {
		        return '';
		    }
	        }),
                target: '_new'
            })));
        }
        linkPopupHandle = thisB.popit(ev, 'Follow links to...', linkList);
    }, false);

    // set up the navigator

    var navPopupHandle;
    this.regionLabel.addEventListener('mousedown', function(ev) {
        ev.stopPropagation();ev.preventDefault();
        var showing = navPopupHandle && navPopupHandle.displayed;
	thisB.removeAllPopups(); 
        if (showing) {
            return;
        }

        if (thisB.entryPoints == null) {
            alert("entry_points aren't currently available for this genome");
            return;
        }
        var epMenuItems = [], epsByChrName = {};
        for (var epi = 0; epi < thisB.entryPoints.length; ++epi) {
            epMenuItems.push(new EPMenuItem(thisB.entryPoints[epi]));
        }
        
        
        epMenuItems = epMenuItems.sort(function(epmi0, epmi1) {
            var n0 = epmi0.nums;
            var n1 = epmi1.nums;
            var idx = 0;
            while (true) {
                if (idx >= n0.length) {
                    return -1;
                } else if (idx >= n1.length) {
                    return 1;
                } else {
                    var dif = n0[idx] - n1[idx];
                    if (dif != 0) {
                        return dif;
                    } 
                }
                ++idx;
            }
        });

        var popup = makeElement('div');
        popup.style.padding = '5px';
        popup.style.paddingRight = '9px';
       
        {
            var form = makeElement('form');
            
            form.appendChild(document.createTextNode('Location:'));
            var locWarning = makeElement('div', null, {}, {'color': 'red'});
            form.appendChild(locWarning);
            var locInput = (makeElement('input', null, {type: 'text', value: (thisB.chr + ':' + (thisB.viewStart|0) + '..' + (thisB.viewEnd|0))}));
            form.appendChild(locInput);
            form.appendChild(makeElement('br'));
            form.appendChild(makeElement('input', null, {type: 'submit', value: 'Go'}));
            popup.appendChild(form);
        }
        navPopupHandle = thisB.popit(ev, 'Jump to...', popup, {width: 300});

	form.addEventListener('submit', function(ev) {
	    ev.stopPropagation();ev.preventDefault();

            var locString = locInput.value.trim();
            var match = /^([A-Za-z0-9]+)[:\t ]([0-9]+)([-:.\t ]+([0-9]+))?$/.exec(locString);
            if (match && match.length == 5) {
                var nchr = match[1];
	        var nmin = stringToInt(match[2]);
                if (match[4]) {
	            var nmax = stringToInt(match[4]);
                } else {
                    var wid = thisB.viewEnd - thisB.viewStart + 1;
                    nmin = nmin - (wid/2)|0;
                    nmax = nmin + wid;
                }
	        
                if (nchr != thisB.chr) {
                    thisB.highlightMin = -1;
                    thisB.highlightMax = -1;
                }
                
                try {
		    thisB.setLocation(nmin, nmax, nchr);
                    thisB.removeAllPopups();
                } catch (msg) {
                    removeChildren(locWarning);
                    locWarning.appendChild(document.createTextNode(msg));
                }
            } else {
                removeChildren(locWarning);
                locWarning.appendChild(document.createTextNode('Should match chr:start...end or chr:midpoint'));
            }
	    return false;
	}, false);

        if (thisB.searchEndpoint) {
            var geneForm = makeElement('form');
            geneForm.appendChild(makeElement('p', 'Or search for...'))
            geneForm.appendChild(document.createTextNode('Gene:'));
            var geneInput = makeElement('input', null, {value: ''});
            geneForm.appendChild(geneInput);
            geneForm.appendChild(makeElement('br'));
            geneForm.appendChild(makeElement('input', null, {type: 'submit', value: 'Go'}));
            popup.appendChild(geneForm);
        
	
	    geneForm.addEventListener('submit', function(ev) {
	        ev.stopPropagation();ev.preventDefault();
	        var g = geneInput.value;
	        thisB.removeAllPopups();

	        if (!g || g.length == 0) {
		    return false;
	        }

	        thisB.searchEndpoint.features(null, {group: g, type: 'transcript'}, function(found) {        // HAXX
                    if (!found) found = [];
                    var min = 500000000, max = -100000000;
		    var nchr = null;
		    for (var fi = 0; fi < found.length; ++fi) {
			var f = found[fi];

                        if (f.label != g) {
                            // ...because Dazzle can return spurious overlapping features.
                            continue;
                        }

			if (nchr == null) {
			    nchr = f.segment;
			}
			min = Math.min(min, f.min);
			max = Math.max(max, f.max);
		    }

		    if (!nchr) {
		        alert("no match for '" + g + "' (NB. server support for search is currently rather limited...)");
		    } else {
		        thisB.highlightMin = min;
		        thisB.highlightMax = max;
		        thisB.makeHighlight();

		        var padding = Math.max(2500, (0.3 * (max - min + 1))|0);
		        thisB.setLocation(min - padding, max + padding, nchr);
		    }
	        }, false);
                
	        return false;
	    }, false);
        }

    }, false);

  
    var addPopupHandle;
    addButton.addEventListener('mousedown', function(ev) {
	ev.stopPropagation();ev.preventDefault();
        var showing = addPopupHandle && addPopupHandle.displayed;
	thisB.removeAllPopups();
        if (!showing) {
            addPopupHandle = thisB.showTrackAdder(ev);
        }
    }, false);

    // set up the resetter
    resetButton.addEventListener('mousedown', function(ev) {
        ev.stopPropagation();ev.preventDefault();

        removeChildren(thisB.tierHolder);
        removeChildren(thisB.dasLabelHolder);
        thisB.tiers = [];
        thisB.sources = [];
        thisB.knownSpace = null;

        for (var t = 0; t < thisB.defaultSources.length; ++t) {
	    var source = thisB.defaultSources[t];
            thisB.sources.push(source);
            thisB.makeTier(source);
        }
        thisB.arrangeTiers();
        thisB.highlightMin = thisB.highlightMax = -1;
        thisB.setLocation(thisB.defaultStart, thisB.defaultEnd, thisB.defaultChr);
    }, false);
	
    this.tierHolder = dasTiers;
    this.tiers = [];
    if (overrideSources) {
	this.sources = overrideSources;
    }
    for (var t = 0; t < this.sources.length; ++t) {
	var source = this.sources[t];
        if (source.bwgURI && !this.supportsBinary) {
            if (!this.binaryWarningGiven) {
                this.popit({clientX: 300, clientY: 100}, 'Warning', makeElement('p', 'your browser does not support binary data formats, some track(s) not loaded.  We currently recommend Google Chrome 9 or later, or Firefox 4 or later.'));
                this.binaryWarningGiven = true;
            }
            continue;
        }
        this.makeTier(source);
    }
    thisB.arrangeTiers();
    
    //
    // Window resize support (should happen before first fetch so we know the actual size of the viewed area).
    //

    this.resizeViewer(true);
    window.addEventListener('resize', function(ev) {
        thisB.resizeViewer();
    }, false);

    //
    // Finalize initial viewable region, and kick off a fetch.
    //

    if (qChr && qMin && qMax) {
        this.chr = qChr;this.viewStart = qMin;this.viewEnd = qMax;
	if (this.highlightMin < 0) {
	    this.highlightMin = qMin;this.highlightMax = qMax;
	}
    }
    
    if ((this.viewEnd - this.viewStart) > MAX_VIEW_SIZE) {
        var mid = ((this.viewEnd + this.viewStart) / 2)|0;
        this.viewStart = mid - (MAX_VIEW_SIZE/2);
        this.viewEnd = mid + (MAX_VIEW_SIZE/2) - 1;
    }

    this.origin = ((this.viewStart + this.viewEnd) / 2) | 0;
    this.scale = this.featurePanelWidth / (this.viewEnd - this.viewStart);

    this.zoomExpt = 250 / Math.log(MAX_VIEW_SIZE / this.zoomBase);
    this.zoomSlider.setValue(this.zoomExpt * Math.log((this.viewEnd - this.viewStart + 1) / this.zoomBase));

    this.move(0); // will trigger a refresh() after failing spaceCheck.

    //
    // Tick-marks on the zoomer
    //

    this.makeZoomerTicks();

    // 
    // Set up interactivity handlers
    //

    this.__mouseMoveHandler = function(ev) {
        return thisB.mouseMoveHandler(ev);
    }
    this.__mouseUpHandler = function(ev) {
        return thisB.mouseUpHandler(ev);
    }
    main.addEventListener('mousedown', function(ev) {return thisB.mouseDownHandler(ev)}, false);

/*
    main.addEventListener('touchstart', touchStartHandler, false);
    main.addEventListener('touchmove', touchMoveHandler, false);
    main.addEventListener('touchend', touchEndHandler, false);
    main.addEventListener('touchcancel', touchCancelHandler, false); */

    this.svgRoot.addEventListener('mousewheel', function(ev) {   // FIXME does this need to be on the document?
	if (!ev.wheelDeltaX) {
	    return;
	}

	ev.stopPropagation();ev.preventDefault();
	thisB.move(-ev.wheelDeltaX/5);
    }, false);
    this.svgRoot.addEventListener('MozMousePixelScroll', function(ev) {
	if (ev.axis == 1) {
	    ev.stopPropagation();ev.preventDefault();
	    if (ev.detail != 0) {
		thisB.move(ev.detail/4);
	    }
        }
    }, false);

    var keyHandler = function(ev) {
        // dlog('keycode=' + ev.keyCode + '; charCode=' + ev.charCode);
        if (ev.keyCode == 13) {
            var layoutsChanged = false;
            for (var ti = 0; ti < thisB.tiers.length; ++ti) {
                var t = thisB.tiers[ti];
                if (t.wantedLayoutHeight && t.wantedLayoutHeight != t.layoutHeight) {
                    t.layoutHeight = t.wantedLayoutHeight;
                    t.placard = null;
                    t.clipTier();
                    layoutsChanged = true;
                }
            }
            if (layoutsChanged) {
                thisB.arrangeTiers();
            }
        } else if (ev.keyCode == 32 || ev.charCode == 32) {
            if (!thisB.snapZoomLockout) {
                if (!thisB.isSnapZooming) {
                    thisB.isSnapZooming = true;
                    var newZoom = thisB.savedZoom || 1.0;
                    thisB.savedZoom = thisB.zoomSlider.getValue();
                    thisB.zoomSlider.setValue(newZoom);
                    thisB.zoom(Math.exp((1.0 * newZoom) / thisB.zoomExpt));
                    thisB.invalidateLayouts();
                    thisB.zoomSlider.setColor('red');
                    thisB.refresh();
                } else {
                    thisB.isSnapZooming = false;
                    var newZoom = thisB.savedZoom || 10.0;
                    thisB.savedZoom = thisB.zoomSlider.getValue();
                    thisB.zoomSlider.setValue(newZoom);
                    thisB.zoom(Math.exp((1.0 * newZoom) / thisB.zoomExpt));
                    thisB.invalidateLayouts();
                    thisB.zoomSlider.setColor('blue');
                    thisB.refresh();
                }
                thisB.snapZoomLockout = true;
            }
            ev.stopPropagation();ev.preventDefault();      
        } else if (ev.keyCode == 39) {
            ev.stopPropagation();ev.preventDefault();
            thisB.move(ev.shiftKey ? 100 : 25);
        } else if (ev.keyCode == 37) {
            ev.stopPropagation();ev.preventDefault();
            thisB.move(ev.shiftKey ? -100 : -25);
        } else if (ev.charCode == 61) {
            ev.stopPropagation();ev.preventDefault();

            var oz = thisB.zoomSlider.getValue();
            thisB.zoomSlider.setValue(oz - 10);
            var nz = thisB.zoomSlider.getValue();
            if (nz != oz) {
                thisB.zoom(Math.exp((1.0 * nz) / thisB.zoomExpt));
                thisB.scheduleRefresh(500);
            }
        } else if (ev.charCode == 45) {
            ev.stopPropagation();ev.preventDefault();

            var oz = thisB.zoomSlider.getValue();
            thisB.zoomSlider.setValue(oz + 10);
            var nz = thisB.zoomSlider.getValue();
            if (nz != oz) {
                thisB.zoom(Math.exp((1.0 * nz) / thisB.zoomExpt));
                thisB.scheduleRefresh(500);
            }
        } else if (ev.keyCode == 84) {
            var bumpStatus;
            for (var ti = 0; ti < thisB.tiers.length; ++ti) {
                var t = thisB.tiers[ti];
                if (t.dasSource.collapseSuperGroups) {
                    if (bumpStatus === undefined) {
                        bumpStatus = !t.bumped;
                    }
                    t.bumped = bumpStatus;
                    t.layoutWasDone = false;
                    t.draw();
                }
            }
        }
    };
    var keyUpHandler = function(ev) {

        thisB.snapZoomLockout = false;
/*
        if (ev.keyCode == 32) {
            if (thisB.isSnapZooming) {
                thisB.isSnapZooming = false;
                thisB.zoomSlider.setValue(thisB.savedZoom);
                thisB.zoom(Math.exp((1.0 * thisB.savedZoom / thisB.zoomExpt)));
                thisB.invalidateLayouts();
                thisB.refresh();
            }
            ev.stopPropagation(); ev.preventDefault();
        } */
    }

    var mouseLeaveHandler;
    mouseLeaveHandler = function(ev) {
        window.removeEventListener('keydown', keyHandler, false);
        window.removeEventListener('keyup', keyUpHandler, false);
        window.removeEventListener('keypress', keyHandler, false);
        thisB.svgRoot.removeEventListener('mouseout', mouseLeaveHandler, false);
    }

    this.svgRoot.addEventListener('mouseover', function(ev) {
        window.addEventListener('keydown', keyHandler, false);
        window.addEventListener('keyup', keyUpHandler, false);
        window.addEventListener('keypress', keyHandler, false);
        thisB.svgRoot.addEventListener('mouseout', mouseLeaveHandler, false);
    }, false);
    
    // Low-priority stuff
    this.storeStatus();   // to make sure things like resets are permanent.

    var epSource;
    for (var ti = 0; ti < this.tiers.length; ++ti) {
        var s = this.tiers[ti].dasSource;
        if (s.provides_entrypoints) {
            epSource = this.tiers[ti].dasSource;
            break;
        }
    }
    if (epSource) {
        epSource.entryPoints(
            function(ep) {
                thisB.entryPoints = ep;
                for (var epi = 0; epi < thisB.entryPoints.length; ++epi) {
                    if (thisB.entryPoints[epi].name == thisB.chr) {
                        thisB.currentSeqMax = thisB.entryPoints[epi].end;
                        break;
                    }
                }
            }
        );
    }

    thisB.queryRegistry(null, true);
    for (var m in this.chains) {
        this.queryRegistry(m, true);
    }
    
    //jw stuff for getting it to open at mgi accession
//          var query = window.location.search.substring(1);
//          
//    var params=query.split('=');
//    if(params.length>1){
//    var mgiAccession=params[1];
//    console.debug('mgiAccession='+mgiAccession);
// 
// var chromosome='10';
// var start=20000000;
// var stop=20030000;
//        
//         $(function() {
// $.ajax({
//  'url': 'http://www.sanger.ac.uk/mouseportal/solr/select',
//  'data': {'wt':'json', 'q':mgiAccession},
//  'success': function(data) { 
//      var doc=data.response.docs[0];
//      chromosome=doc.chromosome;
//      start=doc.coord_start-1000;
//      stop=doc.coord_end+1000;
//      console.debug('chromosome='+chromosome+' ' +start+' '+stop);
//      thisB.setLocation(start, stop, chromosome);
//       
//       /* process e.g. data.response.docs... */ },
//  'dataType': 'jsonp',
//  'jsonp': 'json.wrf'});
//});
//    
//}
//        
        //end of jw stuff
}

function setSources(msh, availableSources, maybeMapping) {
    if (maybeMapping) {
        for (var s = 0; s < availableSources.length; ++s) {
            availableSources[s].mapping = maybeMapping;
        }
    }
    msh.set(availableSources);
}

Browser.prototype.queryRegistry = function(maybeMapping, tryCache) {
    var thisB = this;
    var coords, msh;
    if (maybeMapping) {
        coords = this.chains[maybeMapping].coords;
        if (!thisB.mappableSources[maybeMapping]) {
            thisB.mappableSources[maybeMapping] = new Observed();
        }
        msh = thisB.mappableSources[maybeMapping];
    } else {
        coords = this.coordSystem;
        msh = this.availableSources;
    }
    var cacheHash = hex_sha1(miniJSONify(coords));
    if (tryCache) {
        var cacheTime = localStorage['dalliance.registry.' + cacheHash + '.last_queried'];
        if (cacheTime) {
            try {
                setSources(msh, JSON.parse(localStorage['dalliance.registry.' + cacheHash + '.sources']), maybeMapping);
                var cacheAge = (Date.now()|0) - (cacheTime|0);
                if (cacheAge < (12 * 60 * 60 * 1000)) {
                    // alert('Using cached registry data');
                    return;
                } else {
                    // alert('Registry data is stale, refetching');
                }
            } catch (rex) {
                dlog('Bad registry cache: ' + rex);
            }
        }
    }
            
    new DASRegistry(this.registry).sources(function(sources) {
	var availableSources = [];
        for (var s = 0; s < sources.length; ++s) {
            var source = sources[s];
            if (!source.coords || source.coords.length == 0) {
                continue;
            }
            var scoords = source.coords[0];
            if (scoords.taxon != coords.taxon || scoords.auth != coords.auth || scoords.version != coords.version) {
                continue;
            }   
            availableSources.push(source);
        }

        localStorage['dalliance.registry.' + cacheHash + '.sources'] = JSON.stringify(availableSources);
        localStorage['dalliance.registry.' + cacheHash + '.last_queried'] = '' + Date.now();
        
        setSources(msh, availableSources, maybeMapping);
    }, function(error) {
        // msh.set(null);
    }, coords);
}

Browser.prototype.makeTier = function(source) {
    try {
        this.realMakeTier(source);
    } catch (err) {
        dlog('Error creating tier: ' + err);
        // ...and continue.
    }
}

Browser.prototype.realMakeTier = function(source) {
    var viewport = document.createElementNS(NS_SVG, 'g');
    var viewportBackground = document.createElementNS(NS_SVG, 'rect');
    var col = this.tierBackgroundColors[this.tiers.length % this.tierBackgroundColors.length];
    viewportBackground.setAttribute('fill', col);
    viewportBackground.setAttribute('x', "-1000000");
    viewportBackground.setAttribute('y', "0");
    viewportBackground.setAttribute('width', "2000000");
    viewportBackground.setAttribute('height', "200");
    viewportBackground.setAttribute('stroke-width', "0");
    viewport.appendChild(viewportBackground);
    viewport.setAttribute("transform", "translate(200, " + ((2 * 200) + 50) + ")");
    
    var tier = new DasTier(this, source, viewport, viewportBackground);
    tier.init(); // fetches stylesheet

    this.tierHolder.appendChild(viewport);    
    this.tiers.push(tier);  // NB this currently tells any extant knownSpace about the new tier.
    this.refreshTier(tier);
    this.arrangeTiers();
}

Browser.prototype.removeTier = function(tier) {
    var ti = arrayIndexOf(this.tiers, tier);
    if (ti < 0) {
        return dlog("Couldn't find tier");
    }
            
    var deadTier = this.tiers[ti];
    this.tierHolder.removeChild(deadTier.viewport);
    if (deadTier.label) {
        this.dasLabelHolder.removeChild(deadTier.label);
    }
            
    this.tiers.splice(ti, 1);
    for (var nti = 0; nti < this.tiers.length; ++nti) {
        this.tiers[nti].background.setAttribute("fill", this.tierBackgroundColors[nti % this.tierBackgroundColors.length]);
        this.tiers[nti].isLabelValid = false;
    }

    this.arrangeTiers();
    this.storeStatus();
}

Browser.prototype.makeZoomerTicks = function() {
    var thisB = this;
    removeChildren(this.zoomTickMarks);

    var makeSliderMark = function(markSig) {
        var markPos = thisB.zoomExpt * Math.log(markSig/thisB.zoomBase);
        if (markPos < 0 || markPos > 250) {
            return;
        }
        var smark = makeElementNS(NS_SVG, 'line', null, {
            x1: 30 + markPos,
            y1: 35,
            x2: 30 + markPos,
            y2: 38,
            stroke: 'gray',
            strokeWidth: 1
        });
        var markText;
        if (markSig > 1500) {
            markText = '' + (markSig/1000) + 'kb';
        } else {
            markText= '' + markSig + 'bp';
        }
        var slabel = makeElementNS(NS_SVG, 'text', markText, {
            x: 30 + markPos,
            y: 48,
            fontSize: '8pt',
            stroke: 'none'
        });
        thisB.zoomTickMarks.appendChild(smark);
        thisB.zoomTickMarks.appendChild(slabel);
        slabel.setAttribute('x', 29 + markPos - (slabel.getBBox().width/2));
    }

    makeSliderMark(1000000);
    makeSliderMark(500000);
    makeSliderMark(100000);
    makeSliderMark(20000);
    makeSliderMark(4000);
    makeSliderMark(500);
    makeSliderMark(100);
    makeSliderMark(50);
}


Browser.prototype.resizeViewer = function(skipRefresh) {
    var width = window.innerWidth;
    width = Math.max(width, 640);

    if (this.forceWidth) {
        width = this.forceWidth;
    }

    if (this.center) {
        this.svgHolder.style['margin-left'] = (((window.innerWidth - width) / 2)|0) + 'px';
    }

    this.svgRoot.setAttribute('width', width - 30);
    this.svgBackground.setAttribute('width', width - 30);
    this.featureClipRect.setAttribute('width', width - this.tabMargin - 40);
    this.featureBackground.setAttribute('width', width - this.tabMargin - 40);

    this.zoomWidget.setAttribute('transform', 'translate(' + (width - this.zoomSlider.width - 100) + ', 0)');
    if (width < 1075) {
        this.karyo.svg.setAttribute('transform', 'translate(2000, 15)');
    } else {
        this.karyo.svg.setAttribute('transform', 'translate(450, 20)');
    }
    this.regionLabelMax = (width - this.zoomSlider.width - 120)
    var oldFPW = this.featurePanelWidth;
    this.featurePanelWidth = (width - this.tabMargin - 40)|0;
    
    if (oldFPW != this.featurePanelWidth) {
        var viewWidth = this.viewEnd - this.viewStart;
	var nve = this.viewStart + (viewWidth * this.featurePanelWidth) / oldFPW;
	var delta = nve - this.viewEnd;
	this.viewStart = this.viewStart - (delta/2);
	this.viewEnd = this.viewEnd + (delta/2);

	var wid = this.viewEnd - this.viewStart + 1;
	if (this.currentSeqMax > 0 && this.viewEnd > this.currentSeqMax) {
            this.viewEnd = this.currentSeqMax;
            this.viewStart = this.viewEnd - wid + 1;
	}
	if (this.viewStart < 1) {
            this.viewStart = 1;
            this.viewEnd = this.viewStart + wid - 1;
	}
    
	this.xfrmTiers((this.tabMargin - (1.0 * (this.viewStart - this.origin)) * this.scale), 1);
	this.updateRegion();
        if (!skipRefresh) {
	    this.spaceCheck();
        }
    }

    if (this.fgGuide) {
	this.fgGuide.setAttribute('x1', (this.featurePanelWidth/2) + this.tabMargin);
	this.fgGuide.setAttribute('x2', (this.featurePanelWidth/2) + this.tabMargin);
    }
	

    for (var pi = 0; pi < this.placards.length; ++pi) {
	var placard = this.placards[pi];
	var rects = placard.getElementsByTagName('rect');
	if (rects.length > 0) {
	    rects[0].setAttribute('width', this.featurePanelWidth);
	}
    }
}

Browser.prototype.xfrmTiers = function(x, xs) {
    for (var ti = 0; ti < this.tiers.length; ++ti) {
        this.xfrmTier(this.tiers[ti], x, xs);
    }
    if (this.highlight) {
	var axs = xs;
	if (axs < 0) {
            axs = this.scale;
	}
	var xfrm = 'translate(' + x + ',0)';
	this.highlight.setAttribute('transform', xfrm);
	this.highlight.setAttribute('x', (this.highlightMin - this.origin) * this.scale);
	this.highlight.setAttribute('width', (this.highlightMax - this.highlightMin + 1) * this.scale);
    } 
}

Browser.prototype.jiggleLabels = function(tier) {
        var x = tier.xfrmX;
        var labels = tier.viewport.getElementsByClassName("label-text");
        for (var li = 0; li < labels.length; ++li) {
            var label = labels[li];
            //console.debug(label);
            if (label.jiggleMin && label.jiggleMax) {
                label.setAttribute('x', Math.min(Math.max(this.tabMargin - x, label.jiggleMin), label.jiggleMax));
            }
        }
}
        
Browser.prototype.xfrmTier = function(tier, x , xs) {
    if (tier.originHaxx && tier.originHaxx != 0) {
	x -= ((1.0 * tier.originHaxx) * this.scale);
    }
   
    var axs = xs;
    if (axs < 0) {
        axs = tier.scale;
    } else {
        tier.scale = xs;
    }

    var y = tier.y;
        
    if (x != tier.xfrmX || y != tier.xfrmY || axs != tier.xfrmS) {
        var xfrm = 'translate(' + x + ',' + tier.y + ')';
        if (axs != 1) {
            xfrm += ', scale(' + axs + ',1)';
        }
        tier.viewport.setAttribute('transform', xfrm);
    }
    if (tier.label && (y != tier.xfrmY || !tier.isLabelValid)) {
        tier.label.setAttribute('transform', 'translate(0, ' + y + ')');
        tier.isLabelValid = true;
    }

    tier.xfrmX = x;
    tier.xfrmY = y;
    tier.xfrmS = axs;

    this.jiggleLabels(tier);
}

//
// Navigation prims.
//

Browser.prototype.spaceCheck = function(dontRefresh) {
    if (!this.knownSpace || this.knownSpace.chr !== this.chr) {
        this.refresh();
        return;
    } 

    var width = ((this.viewEnd - this.viewStart)|0) + 1;
    var minExtraW = (width * this.minExtra) | 0;
    var maxExtraW = (width * this.maxExtra) | 0;
    if ((this.drawnStart|0) > Math.max(1, ((this.viewStart|0) - minExtraW)|0)  || (this.drawnEnd|0) < Math.min((this.viewEnd|0) + minExtraW, ((this.currentSeqMax|0) > 0 ? (this.currentSeqMax|0) : 1000000000)))  {
//         this.drawnStart = Math.max(1, (this.viewStart|0) - maxExtraW);
//        this.drawnEnd = Math.min((this.viewEnd|0) + maxExtraW, ((this.currentSeqMax|0) > 0 ? (this.currentSeqMax|0) : 1000000000));
	this.refresh();
    }
}

Browser.prototype.move = function(pos)
{
    var wid = this.viewEnd - this.viewStart;
    this.viewStart -= pos / this.scale;
    this.viewEnd = this.viewStart + wid;
    if (this.currentSeqMax > 0 && this.viewEnd > this.currentSeqMax) {
        this.viewEnd = this.currentSeqMax;
        this.viewStart = this.viewEnd - wid;
    }
    if (this.viewStart < 1) {
        this.viewStart = 1;
        this.viewEnd = this.viewStart + wid;
    }
    
    this.xfrmTiers((this.tabMargin - (1.0 * (this.viewStart - this.origin)) * this.scale), 1);
    this.updateRegion();
    this.karyo.update(this.chr, this.viewStart, this.viewEnd);
    this.spaceCheck();
}

Browser.prototype.zoom = function(factor) {
    this.zoomFactor = factor;
    var viewCenter = Math.round((this.viewStart + this.viewEnd) / 2.0)|0;
    this.viewStart = viewCenter - this.zoomBase * this.zoomFactor / 2;
    this.viewEnd = viewCenter + this.zoomBase * this.zoomFactor / 2;
    if (this.currentSeqMax > 0 && (this.viewEnd > this.currentSeqMax + 5)) {
        var len = this.viewEnd - this.viewStart + 1;
        this.viewEnd = this.currentSeqMax;
        this.viewStart = this.viewEnd - len + 1;
    }
    if (this.viewStart < 1) {
        var len = this.viewEnd - this.viewStart + 1;
        this.viewStart = 1;
        this.viewEnd = this.viewStart + len - 1;
    }
    this.scale = this.featurePanelWidth / (this.viewEnd - this.viewStart)
    this.updateRegion();

    var width = this.viewEnd - this.viewStart + 1;
    
    var scaleRat = (this.scale / this.scaleAtLastRedraw);
    this.xfrmTiers(this.tabMargin - ((1.0 * (this.viewStart - this.origin)) * this.scale),  (this.scale / this.scaleAtLastRedraw));

    var labels = this.svgRoot.getElementsByClassName("label-text");
    for (var li = 0; li < labels.length; ++li) {
        var label = labels[li];
        var x = label.getAttribute("x");
        var xfrm = "scale(" + (this.scaleAtLastRedraw/this.scale) + ",1), translate( " + ((x*this.scale - x*this.scaleAtLastRedraw) /this.scaleAtLastRedraw) +",0)";
        label.setAttribute("transform", xfrm);
    }
}

Browser.prototype.setLocation = function(newMin, newMax, newChr) {
    newMin = newMin|0;
    newMax = newMax|0;
//console.debug('calling setLocation');
    if (newChr && (newChr != this.chr)) {
	if (!this.entryPoints) {
            throw 'Need entry points';
	}
	var ep = null;
	for (var epi = 0; epi < this.entryPoints.length; ++epi) {
            var epName = this.entryPoints[epi].name;
	    if (epName === newChr || ('chr' + epName) === newChr || epName === ('chr' + newChr)) {
		ep = this.entryPoints[epi];
		break;
	    }
	}
	if (!ep) {
            throw "Couldn't find chromosome " + newChr;
	}

	this.chr = ep.name;
	this.currentSeqMax = ep.end;
    }

    var newWidth = newMax - newMin + 1;
    if (newWidth > MAX_VIEW_SIZE) {
        newMin = ((newMax + newMin - MAX_VIEW_SIZE)/2)|0;
        newMax = (newMin + MAX_VIEW_SIZE - 1)|0;
    }
    if (newWidth < this.zoomBase) {
        newMin = ((newMax + newMin - this.zoomBase)/2)|0;
        mewMax = (newMin + this.zoomBase - 1)|0;
    }

    if (newMin < 1) {
	var wid = newMax - newMin + 1;
	newMin = 1;
	newMax = Math.min(newMin + wid - 1, this.currentSeqMax);
    }
    if (this.currentSeqMax > 0 && newMax > this.currentSeqMax) {
	var wid = newMax - newMin + 1;
	newMax = this.currentSeqMax;
	newMin = Math.max(1, newMax - wid + 1);
    }

    this.viewStart = newMin|0;
    this.viewEnd = newMax|0;
    this.scale = this.featurePanelWidth / (this.viewEnd - this.viewStart);
    this.zoomSlider.setValue(this.zoomExpt * Math.log((this.viewEnd - this.viewStart + 1) / this.zoomBase));

    this.updateRegion();
    this.karyo.update(this.chr, this.viewStart, this.viewEnd);
    this.spaceCheck();
    this.xfrmTiers(this.tabMargin - ((1.0 * (this.viewStart - this.origin)) * this.scale), 1);   // FIXME currently needed to set the highlight (!)
    this.storeStatus();
}


Browser.prototype.storeStatus = function(){
//    if (!this.cookieKey || this.noPersist) {
//	return;
//    }
//
//    localStorage['dalliance.' + this.cookieKey + '.view-chr'] = this.chr;
//    localStorage['dalliance.' + this.cookieKey + '.view-start'] = this.viewStart|0;
//    localStorage['dalliance.' + this.cookieKey + '.view-end'] = this.viewEnd|0
//
//    var currentSourceList = [];
//    for (var t = 0; t < this.tiers.length; ++t) {
//        var ts = this.tiers[t].dasSource;
//        if (!ts.noPersist) {
//	    currentSourceList.push(this.tiers[t].dasSource);
//        }
//    }
//    localStorage['dalliance.' + this.cookieKey + '.sources'] = JSON.stringify(currentSourceList);
//    localStorage['dalliance.' + this.cookieKey + '.version'] = VERSION.CONFIG;
}

Browser.prototype.scheduleRefresh = function(time) {
    if (!time) {
        time = 500;
    }
    var thisB = this;

    if (this.refreshTB) {
        clearTimeout(this.refreshTB);
    }
    this.refreshTB = setTimeout(function() {
        thisB.refreshTB = null;
        thisB.refresh();
    }, time);
}

Browser.prototype.invalidateLayouts = function() {
    for (var t = 0; t < this.tiers.length; ++t) {
        this.tiers[t].layoutWasDone = false;
    }
}

Browser.prototype.refreshTier = function(tier) {
    if (this.knownSpace) {
        this.knownSpace.invalidate(tier);
    }
}/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// chainset.js: liftover support
//

function Chainset(uri, srcTag, destTag, coords) {
    this.uri = uri;
    this.srcTag = srcTag;
    this.destTag = destTag;
    this.coords = coords;
    this.chainsBySrc = {};
    this.chainsByDest = {};
    this.postFetchQueues = {};
}

function parseCigar(cigar)
{
    var cigops = [];
    var CIGAR_REGEXP = new RegExp('([0-9]*)([MID])', 'g');
    var match;
    while ((match = CIGAR_REGEXP.exec(cigar)) != null) {
        var count = match[1];
        if (count.length == 0) {
            count = 1;
        }
        cigops.push({cnt: count|0, op: match[2]});
    }
    return cigops;
}

Chainset.prototype.fetchChainsTo = function(chr) {
    var thisCS = this;
    new DASSource(this.uri).alignments(chr, {}, function(aligns) {
        if (!thisCS.chainsByDest[chr]) {
            thisCS.chainsByDest[chr] = []; // prevent re-fetching.
        }

        for (var ai = 0; ai < aligns.length; ++ai) {
            var aln = aligns[ai];
            for (var bi = 0; bi < aln.blocks.length; ++bi) {
                var block = aln.blocks[bi];
                var srcSeg, destSeg;
                for (var si = 0; si < block.segments.length; ++si) {
                    var seg = block.segments[si];
                    var obj = aln.objects[seg.object];
                    if (obj.dbSource === thisCS.srcTag) {
                        srcSeg = seg;
                    } else if (obj.dbSource === thisCS.destTag) {
                        destSeg = seg;
                    }
                }
                if (srcSeg && destSeg) {
                    var chain = {
                        srcChr:     aln.objects[srcSeg.object].accession,
                        srcMin:     srcSeg.min|0,
                        srcMax:     srcSeg.max|0,
                        srcOri:     srcSeg.strand,
                        destChr:    aln.objects[destSeg.object].accession,
                        destMin:    destSeg.min|0,
                        destMax:    destSeg.max|0,
                        destOri:    destSeg.strand,
                        blocks:     []
                    }

                    var srcops = parseCigar(srcSeg.cigar), destops = parseCigar(destSeg.cigar);
                    var srcOffset = 0, destOffset = 0;
                    var srci = 0, desti = 0;
                    while (srci < srcops.length && desti < destops.length) {
                        if (srcops[srci].op == 'M' && destops[desti].op == 'M') {
                            var blockLen = Math.min(srcops[srci].cnt, destops[desti].cnt);
                            chain.blocks.push([srcOffset, destOffset, blockLen]);
                            if (srcops[srci].cnt == blockLen) {
                                ++srci;
                            } else {
                                srcops[srci].cnt -= blockLen;
                            }
                            if (destops[desti].cnt == blockLen) {
                                ++desti;
                            } else {
                                destops[desti] -= blockLen;
                            }
                            srcOffset += blockLen;
                            destOffset += blockLen;
                        } else if (srcops[srci].op == 'I') {
                            destOffset += srcops[srci++].cnt;
                        } else if (destops[desti].op == 'I') {
                            srcOffset += destops[desti++].cnt;
                        }
                    }

                    pusho(thisCS.chainsBySrc, chain.srcChr, chain);
                    pusho(thisCS.chainsByDest, chain.destChr, chain);
                }
            }
        }

        if (thisCS.postFetchQueues[chr]) {
            var pfq = thisCS.postFetchQueues[chr];
            for (var i = 0; i < pfq.length; ++i) {
                pfq[i]();
            }
            thisCS.postFetchQueues[chr] = null;
        }
    });
}

Chainset.prototype.mapPoint = function(chr, pos) {
    var chains = this.chainsBySrc[chr] || [];
    for (var ci = 0; ci < chains.length; ++ci) {
        var c = chains[ci];
        if (pos >= c.srcMin && pos <= c.srcMax) {
            var cpos;
            if (c.srcOri == '-') {
                cpos = c.srcMax - pos;
            } else {
                cpos = pos - c.srcMin;
            }
            var blocks = c.blocks;
            for (var bi = 0; bi < blocks.length; ++bi) {
                var b = blocks[bi];
                var bSrc = b[0];
                var bDest = b[1];
                var bSize = b[2];
                if (cpos >= bSrc && cpos <= (bSrc + bSize)) {
                    var apos = cpos - bSrc;

                    var dpos;
                    if (c.destOri == '-') {
                        dpos = c.destMax - bDest - apos;
                    } else {
                        dpos = apos + bDest + c.destMin;
                    }
                    return {seq: c.destChr, pos: dpos, flipped: (c.srcOri != c.destOri)}
                }
            }
        }
    }
    return null;
}

Chainset.prototype.unmapPoint = function(chr, pos) {
    var chains = this.chainsByDest[chr] || [];
    for (var ci = 0; ci < chains.length; ++ci) {
        var c = chains[ci];
        if (pos >= c.destMin && pos <= c.destMax) {
            var cpos;
            if (c.srcOri == '-') {
                cpos = c.destMax - pos;
            } else {
                cpos = pos - c.destMin;
            }    
            
            var blocks = c.blocks;
            for (var bi = 0; bi < blocks.length; ++bi) {
                var b = blocks[bi];
                var bSrc = b[0];
                var bDest = b[1];
                var bSize = b[2];
                if (cpos >= bDest && cpos <= (bDest + bSize)) {
                    var apos = cpos - bDest;

                    var dpos = apos + bSrc + c.srcMin;
                    var dpos;
                    if (c.destOri == '-') {
                        dpos = c.srcMax - bSrc - apos;
                    } else {
                        dpos = apos + bSrc + c.srcMin;
                    }
                    return {seq: c.srcChr, pos: dpos, flipped: (c.srcOri != c.destOri)}
                }
            }
            return null;
        }
    }
    return null;
}

Chainset.prototype.sourceBlocksForRange = function(chr, min, max, callback) {
    if (!this.chainsByDest[chr]) {
        var fetchNeeded = !this.postFetchQueues[chr];
        var thisCS = this;
        pusho(this.postFetchQueues, chr, function() {
            thisCS.sourceBlocksForRange(chr, min, max, callback);
        });
        if (fetchNeeded) {
            this.fetchChainsTo(chr);
        }
    } else {
        var mmin = this.unmapPoint(chr, min);
        var mmax = this.unmapPoint(chr, max);
        if (!mmin || !mmax || mmin.seq != mmax.seq) {
            callback([]);
        } else {
            callback([new DASSegment(mmin.seq, mmin.pos, mmax.pos)]);
        }
    }
}
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// das.js: queries and low-level data model.
//

var dasLibErrorHandler = function(errMsg) {
    alert(errMsg);
}
var dasLibRequestQueue = new Array();



function DASSegment(name, start, end, description) {
    this.name = name;
    this.start = start;
    this.end = end;
    this.description = description;
}
DASSegment.prototype.toString = function() {
    return this.name + ':' + this.start + '..' + this.end;
};
DASSegment.prototype.isBounded = function() {
    return this.start && this.end;
}
DASSegment.prototype.toDASQuery = function() {
    var q = 'segment=' + this.name;
    if (this.start && this.end) {
        q += (':' + this.start + ',' + this.end);
    }
    return q;
}


function DASSource(a1, a2) {
    var options;
    if (typeof a1 == 'string') {
        this.uri = a1;
        options = a2 || {};
    } else {
        options = a1 || {};
    }
    for (var k in options) {
        if (typeof(options[k]) != 'function') {
            this[k] = options[k];
        }
    }


    if (!this.coords) {
        this.coords = [];
    }
    if (!this.props) {
        this.props = {};
    }

    // if (!this.uri || this.uri.length == 0) {
    //    throw "URIRequired";
    // }   FIXME
    if (this.uri && this.uri.substr(this.uri.length - 1) != '/') {
        this.uri = this.uri + '/';
    }
}

function DASCoords() {
}

function coordsMatch(c1, c2) {
    return c1.taxon == c2.taxon && c1.auth == c2.auth && c1.version == c2.version;
}

//
// DAS 1.6 entry_points command
//

DASSource.prototype.entryPoints = function(callback) {
    var dasURI = this.uri + 'entry_points';
    this.doCrossDomainRequest(dasURI, function(responseXML) {
            if (!responseXML) {
                return callback([]);
            }

                var entryPoints = new Array();
                
                var segs = responseXML.getElementsByTagName('SEGMENT');
                for (var i = 0; i < segs.length; ++i) {
                    var seg = segs[i];
                    var segId = seg.getAttribute('id');
                    
                    var segSize = seg.getAttribute('size');
                    var segMin, segMax;
                    if (segSize) {
                        segMin = 1; segMax = segSize;
                    } else {
                        segMin = seg.getAttribute('start');
                        segMax = seg.getAttribute('stop');
                    }
                    var segDesc = null;
                    if (seg.firstChild) {
                        segDesc = seg.firstChild.nodeValue;
                    }
                    entryPoints.push(new DASSegment(segId, segMin, segMax, segDesc));
                }          
               callback(entryPoints);
    });		
}

//
// DAS 1.6 sequence command
// Do we need an option to fall back to the dna command?
//

function DASSequence(name, start, end, alpha, seq) {
    this.name = name;
    this.start = start;
    this.end = end;
    this.alphabet = alpha;
    this.seq = seq;
}

DASSource.prototype.sequence = function(segment, callback) {
    var dasURI = this.uri + 'sequence?' + segment.toDASQuery();
    this.doCrossDomainRequest(dasURI, function(responseXML) {
	if (!responseXML) {
	    callback([]);
	    return;
	} else {
                var seqs = new Array();
                
                var segs = responseXML.getElementsByTagName('SEQUENCE');
                for (var i = 0; i < segs.length; ++i) {
                    var seg = segs[i];
                    var segId = seg.getAttribute('id');
                    var segMin = seg.getAttribute('start');
                    var segMax = seg.getAttribute('stop');
                    var segAlpha = 'DNA';
                    var segSeq = null;
                    if (seg.firstChild) {
                        var rawSeq = seg.firstChild.nodeValue;
                        segSeq = '';
                        var idx = 0;
                        while (true) {
                            var space = rawSeq.indexOf('\n', idx);
                            if (space >= 0) {
                                segSeq += rawSeq.substring(idx, space);
                                idx = space + 1;
                            } else {
                                segSeq += rawSeq.substring(idx);
                                break;
                            }
                        }
                    }
                    seqs.push(new DASSequence(segId, segMin, segMax, segAlpha, segSeq));
                }
                
                callback(seqs);
	}
    });
}

//
// DAS 1.6 features command
//

function DASFeature() {
    // We initialize these in the parser...
}

function DASGroup() {
    // We initialize these in the parser, too...
}

function DASLink(desc, uri) {
    this.desc = desc;
    this.uri = uri;
}

DASSource.prototype.features = function(segment, options, callback) {
    options = options || {};

    var dasURI;
    if (this.uri.indexOf('http://') == 0) {
        dasURI = this.uri + 'features?';

	if (segment) {
	    dasURI += segment.toDASQuery();
	} else if (options.group) {
	    var g = options.group;
	    if (typeof g == 'string') {
		dasURI += ';group_id=' + g;
	    } else {
		for (var gi = 0; gi < g.length; ++gi) {
		    dasURI += ';group_id=' + g[gi];
		}
	    }
	}
        if (options.type) {
            if (typeof options.type == 'string') {
                dasURI += ';type=' + options.type;
            } else {
                for (var ti = 0; ti < options.type.length; ++ti) {
                    dasURI += ';type=' + options.type[ti];
                }
            }
        }
	
        if (options.maxbins) {
            dasURI += ';maxbins=' + options.maxbins;
        }
    } else {
        dasURI = this.uri;
    }
   
    // dlog(dasURI);

    // Feature/group-by-ID stuff?
    
    this.doCrossDomainRequest(dasURI, function(responseXML, req) {

	if (!responseXML) {
            var msg;
            if (req.status == 0) {
                msg = 'server may not support CORS';
            } else {
                msg = 'status=' + req.status;
            }
	    callback([], 'Failed request: ' + msg);
	    return;
	}
/*	if (req) {
	    var caps = req.getResponseHeader('X-DAS-Capabilties');
	    if (caps) {
		alert(caps);
	    }
	} */

        var features = new Array();
        var segmentMap = {};

	var segs = responseXML.getElementsByTagName('SEGMENT');
	for (var si = 0; si < segs.length; ++si) {
            var segmentXML = segs[si];
	    var segmentID = segmentXML.getAttribute('id');
            segmentMap[segmentID] = {
                min: segmentXML.getAttribute('start'),
                max: segmentXML.getAttribute('stop')
            };
	    
            var featureXMLs = segmentXML.getElementsByTagName('FEATURE');
            for (var i = 0; i < featureXMLs.length; ++i) {
                var feature = featureXMLs[i];
                var dasFeature = new DASFeature();
                
		dasFeature.segment = segmentID;
                dasFeature.id = feature.getAttribute('id');
                dasFeature.label = feature.getAttribute('label');
                var spos = elementValue(feature, "START");
                var epos = elementValue(feature, "END");
                if ((spos|0) > (epos|0)) {
                    dasFeature.min = epos;
                    dasFeature.max = spos;
                } else {
                    dasFeature.min = spos;
                    dasFeature.max = epos;
                }
                {
                    var tec = feature.getElementsByTagName('TYPE');
                    if (tec.length > 0) {
                        var te = tec[0];
                        if (te.firstChild) {
                            dasFeature.type = te.firstChild.nodeValue;
                        }
                        dasFeature.typeId = te.getAttribute('id');
                        dasFeature.typeCv = te.getAttribute('cvId');
                    }
                }
                dasFeature.type = elementValue(feature, "TYPE");
                if (!dasFeature.type && dasFeature.typeId) {
                    dasFeature.type = dasFeature.typeId; // FIXME?
                }
                
                dasFeature.method = elementValue(feature, "METHOD");
                {
                    var ori = elementValue(feature, "ORIENTATION");
                    if (!ori) {
                        ori = '0';
                    }
                    dasFeature.orientation = ori;
                }
                dasFeature.score = elementValue(feature, "SCORE");
                dasFeature.links = dasLinksOf(feature);
                dasFeature.notes = dasNotesOf(feature);
                
                var groups = feature.getElementsByTagName("GROUP");
                for (var gi  = 0; gi < groups.length; ++gi) {
                    var groupXML = groups[gi];
                    var dasGroup = new DASGroup();
                    dasGroup.type = groupXML.getAttribute('type');
                    dasGroup.id = groupXML.getAttribute('id');
                    dasGroup.links = dasLinksOf(groupXML);
		    dasGroup.notes = dasNotesOf(groupXML);
                    if (!dasFeature.groups) {
                        dasFeature.groups = new Array(dasGroup);
                    } else {
                        dasFeature.groups.push(dasGroup);
                    }
                }

                // Magic notes.  Check with TAD before changing this.
                if (dasFeature.notes) {
                    for (var ni = 0; ni < dasFeature.notes.length; ++ni) {
                        var n = dasFeature.notes[ni];
                        if (n.indexOf('Genename=') == 0) {
                            var gg = new DASGroup();
                            gg.type='gene';
                            gg.id = n.substring(9);
                            if (!dasFeature.groups) {
                                dasFeature.groups = new Array(gg);
                            } else {
                                dasFeature.groups.push(gg);
                            }
                        }
                    }
                }
                
                {
                    var pec = feature.getElementsByTagName('PART');
                    if (pec.length > 0) {
                        var parts = [];
                        for (var pi = 0; pi < pec.length; ++pi) {
                            parts.push(pec[pi].getAttribute('id'));
                        }
                        dasFeature.parts = parts;
                    }
                }
                {
                    var pec = feature.getElementsByTagName('PARENT');
                    if (pec.length > 0) {
                        var parents = [];
                        for (var pi = 0; pi < pec.length; ++pi) {
                            parents.push(pec[pi].getAttribute('id'));
                        }
                        dasFeature.parents = parents;
                    }
                }
                
                features.push(dasFeature);
            }
	}
                
        callback(features, undefined, segmentMap);
    });
}

function DASAlignment(type) {
    this.type = type;
    this.objects = {};
    this.blocks = [];
}

DASSource.prototype.alignments = function(segment, options, callback) {
    var dasURI = this.uri + 'alignment?query=' + segment;
    this.doCrossDomainRequest(dasURI, function(responseXML) {
        if (!responseXML) {
            callback([], 'Failed request ' + dasURI);
            return;
        }

        var alignments = [];
        var aliXMLs = responseXML.getElementsByTagName('alignment');
        for (var ai = 0; ai < aliXMLs.length; ++ai) {
            var aliXML = aliXMLs[ai];
            var ali = new DASAlignment(aliXML.getAttribute('alignType'));
            var objXMLs = aliXML.getElementsByTagName('alignObject');
            for (var oi = 0; oi < objXMLs.length; ++oi) {
                var objXML = objXMLs[oi];
                var obj = {
                    id:          objXML.getAttribute('intObjectId'),
                    accession:   objXML.getAttribute('dbAccessionId'),
                    version:     objXML.getAttribute('objectVersion'),
                    dbSource:    objXML.getAttribute('dbSource'),
                    dbVersion:   objXML.getAttribute('dbVersion')
                };
                ali.objects[obj.id] = obj;
            }
            
            var blockXMLs = aliXML.getElementsByTagName('block');
            for (var bi = 0; bi < blockXMLs.length; ++bi) {
                var blockXML = blockXMLs[bi];
                var block = {
                    order:      blockXML.getAttribute('blockOrder'),
                    segments:   []
                };
                var segXMLs = blockXML.getElementsByTagName('segment');
                for (var si = 0; si < segXMLs.length; ++si) {
                    var segXML = segXMLs[si];
                    var seg = {
                        object:      segXML.getAttribute('intObjectId'),
                        min:         segXML.getAttribute('start'),
                        max:         segXML.getAttribute('end'),
                        strand:      segXML.getAttribute('strand'),
                        cigar:       elementValue(segXML, 'cigar')
                    };
                    block.segments.push(seg);
                }
                ali.blocks.push(block);
            }       
                    
            alignments.push(ali);
        }
        callback(alignments);
    });
}


function DASStylesheet() {
/*
    this.highZoomStyles = new Object();
    this.mediumZoomStyles = new Object();
    this.lowZoomStyles = new Object();
*/

    this.styles = [];
}

DASStylesheet.prototype.pushStyle = function(filters, zoom, style) {
    /*

    if (!zoom) {
	this.highZoomStyles[type] = style;
	this.mediumZoomStyles[type] = style;
	this.lowZoomStyles[type] = style;
    } else if (zoom == 'high') {
	this.highZoomStyles[type] = style;
    } else if (zoom == 'medium') {
	this.mediumZoomStyles[type] = style;
    } else if (zoom == 'low') {
	this.lowZoomStyles[type] = style;
    }

    */

    if (!filters) {
        filters = {type: 'default'};
    }
    var styleHolder = shallowCopy(filters);
    if (zoom) {
        styleHolder.zoom = zoom;
    }
    styleHolder.style = style;
    this.styles.push(styleHolder);
}

function DASStyle() {
}

DASSource.prototype.stylesheet = function(successCB, failureCB) {
    var dasURI, creds = this.credentials;
    if (this.stylesheet_uri) {
        dasURI = this.stylesheet_uri;
        creds = false;
    } else {
        dasURI = this.uri + 'stylesheet';
    }

    doCrossDomainRequest(dasURI, function(responseXML) {
	if (!responseXML) {
	    if (failureCB) {
		failureCB();
	    } 
	    return;
	}
	var stylesheet = new DASStylesheet();
	var typeXMLs = responseXML.getElementsByTagName('TYPE');
	for (var i = 0; i < typeXMLs.length; ++i) {
	    var typeStyle = typeXMLs[i];
            
            var filter = {};
	    filter.type = typeStyle.getAttribute('id'); // Am I right in thinking that this makes DASSTYLE XML invalid?  Ugh.
            filter.label = typeStyle.getAttribute('label');
            filter.method = typeStyle.getAttribute('method');
	    var glyphXMLs = typeStyle.getElementsByTagName('GLYPH');
	    for (var gi = 0; gi < glyphXMLs.length; ++gi) {
		var glyphXML = glyphXMLs[gi];
		var zoom = glyphXML.getAttribute('zoom');
		var glyph = childElementOf(glyphXML);
		var style = new DASStyle();
		style.glyph = glyph.localName;
		var child = glyph.firstChild;
	
		while (child) {
		    if (child.nodeType == Node.ELEMENT_NODE) {
			// alert(child.localName);
			style[child.localName] = child.firstChild.nodeValue;
		    }
		    child = child.nextSibling;
		}
		stylesheet.pushStyle(filter, zoom, style);
	    }
	}
	successCB(stylesheet);
    }, creds);
}

//
// sources command
// 

function DASRegistry(uri, opts)
{
    opts = opts || {};
    this.uri = uri;
    this.opts = opts;   
}

DASRegistry.prototype.sources = function(callback, failure, opts)
{
    if (!opts) {
        opts = {};
    }

    var filters = [];
    if (opts.taxon) {
        filters.push('organism=' + opts.taxon);
    }
    if (opts.auth) {
        filters.push('authority=' + opts.auth);
    }
    if (opts.version) {
        filters.push('version=' + opts.version);
    }
    var quri = this.uri;
    if (filters.length > 0) {
        quri = quri + '?' + filters.join('&');   // '&' as a separator to hack around dasregistry.org bug.
    }

    doCrossDomainRequest(quri, function(responseXML) {
	if (!responseXML && failure) {
	    failure();
	    return;
	}

	var sources = [];	
	var sourceXMLs = responseXML.getElementsByTagName('SOURCE');
	for (var si = 0; si < sourceXMLs.length; ++si) {
	    var sourceXML = sourceXMLs[si];
	    var versionXMLs = sourceXML.getElementsByTagName('VERSION');
	    if (versionXMLs.length < 1) {
		continue;
	    }
	    var versionXML = versionXMLs[0];

	    var coordXMLs = versionXML.getElementsByTagName('COORDINATES');
	    var coords = [];
	    for (var ci = 0; ci < coordXMLs.length; ++ci) {
		var coordXML = coordXMLs[ci];
		var coord = new DASCoords();
		coord.auth = coordXML.getAttribute('authority');
		coord.taxon = coordXML.getAttribute('taxid');
		coord.version = coordXML.getAttribute('version');
		coords.push(coord);
	    }
	    
	    var capXMLs = versionXML.getElementsByTagName('CAPABILITY');
	    var uri;
	    for (var ci = 0; ci < capXMLs.length; ++ci) {
		var capXML = capXMLs[ci];
		if (capXML.getAttribute('type') == 'das1:features') {
		    var fep = capXML.getAttribute('query_uri');
		    uri = fep.substring(0, fep.length - ('features'.length));
		}
	    }

	    var props = {};
	    var propXMLs = versionXML.getElementsByTagName('PROP');
	    for (var pi = 0; pi < propXMLs.length; ++pi) {
		pusho(props, propXMLs[pi].getAttribute('name'), propXMLs[pi].getAttribute('value'));
	    }
	    
	    if (uri) {
		var source = new DASSource(uri, {
                    source_uri: sourceXML.getAttribute('uri'),
                    name:  sourceXML.getAttribute('title'),
                    desc:  sourceXML.getAttribute('description'),
                    coords: coords,
                    props: props
                });
		sources.push(source);
	    }
	}
	
	callback(sources);
    });
}


//
// Utility functions
//

function elementValue(element, tag)
{
    var children = element.getElementsByTagName(tag);
    if (children.length > 0 && children[0].firstChild) {
        return children[0].firstChild.nodeValue;
    } else {
        return null;
    }
}

function childElementOf(element)
{
    if (element.hasChildNodes()) {
	var child = element.firstChild;
	do {
	    if (child.nodeType == Node.ELEMENT_NODE) {
		return child;
	    } 
	    child = child.nextSibling;
	} while (child != null);
    }
    return null;
}


function dasLinksOf(element)
{
    var links = new Array();
    var maybeLinkChilden = element.getElementsByTagName('LINK');
    for (var ci = 0; ci < maybeLinkChilden.length; ++ci) {
        var linkXML = maybeLinkChilden[ci];
        if (linkXML.parentNode == element) {
            links.push(new DASLink(linkXML.firstChild ? linkXML.firstChild.nodeValue : 'Unknown', linkXML.getAttribute('href')));
        }
    }
    
    return links;
}

function dasNotesOf(element)
{
    var notes = [];
    var maybeNotes = element.getElementsByTagName('NOTE');
    for (var ni = 0; ni < maybeNotes.length; ++ni) {
	if (maybeNotes[ni].firstChild) {
	    notes.push(maybeNotes[ni].firstChild.nodeValue);
	}
    }
    return notes;
}

function doCrossDomainRequest(url, handler, credentials) {
    if (window.XDomainRequest) {
	var req = new XDomainRequest();
	req.onload = function() {
	    var dom = new ActiveXObject("Microsoft.XMLDOM");
	    dom.async = false;
	    dom.loadXML(req.responseText);
	    handler(dom);
	}
	req.open("get", url);
	req.send('');
    } else {
	var req = new XMLHttpRequest();

	req.onreadystatechange = function() {
	    if (req.readyState == 4) {
              if (req.status == 200 || req.status == 0) {
		  handler(req.responseXML, req);
	      }
            }
	};
	req.open("get", url, true);
	if (credentials) {
	    req.withCredentials = true;
	}
	req.send('');
    }
}

DASSource.prototype.doCrossDomainRequest = function(url, handler) {
    return doCrossDomainRequest(url, handler, this.credentials);
}
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// domui.js: SVG UI components
//

Browser.prototype.makeTooltip = function(ele, text)
{
    var isin = false;
    var thisB = this;
    var timer = null;
    var outlistener;
    outlistener = function(ev) {
        isin = false;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        ele.removeEventListener('mouseout', outlistener, false);
    };

    var setup;
    setup = function(ev) {
        var mx = ev.clientX + window.scrollX, my = ev.clientY + window.scrollY;
        if (!timer) {
            timer = setTimeout(function() {
                var popup = makeElement('div', text, {}, {
                    position: 'absolute',
                    top: '' + (my + 20) + 'px',
                    left: '' + Math.max(mx - 30, 20) + 'px',
                    backgroundColor: 'rgb(250, 240, 220)',
                    borderWidth: '1px',
                    borderColor: 'black',
                    borderStyle: 'solid',
                    padding: '2px',
                    maxWidth: '400px'
                });
                thisB.hPopupHolder.appendChild(popup);
                var moveHandler;
                moveHandler = function(ev) {
                    try {
                        thisB.hPopupHolder.removeChild(popup);
                    } catch (e) {
                        // May have been removed by other code which clears the popup layer.
                    }
                    window.removeEventListener('mousemove', moveHandler, false);
                    if (isin) {
                        if (ele.offsetParent == null) {
                            // dlog('Null parent...');
                        } else {
                            setup(ev);
                        }
                    }
                }
                window.addEventListener('mousemove', moveHandler, false);
                timer = null;
            }, 1000);
        }
    };

    ele.addEventListener('mouseover', function(ev) {
        isin = true
        ele.addEventListener('mouseout', outlistener, false);
        setup(ev);
    }, false);
    ele.addEventListener('DOMNodeRemovedFromDocument', function(ev) {
        isin = false;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }, false);
}

Browser.prototype.popit = function(ev, name, ele, opts)
{
    var thisB = this;
    if (!opts) {
        opts = {};
    }

    var width = opts.width || 200;

    var mx =  ev.clientX, my = ev.clientY;
    mx +=  document.documentElement.scrollLeft || document.body.scrollLeft;
    my +=  document.documentElement.scrollTop || document.body.scrollTop;
    var winWidth = window.innerWidth;

    var top = (my + 30);
    var left = Math.min((mx - 30), (winWidth - width - 10));

    var popup = makeElement('div');
    popup.style.position = 'absolute';
    popup.style.top = '' + top + 'px';
    popup.style.left = '' + left + 'px';
    popup.style.width = width + 'px';
    popup.style.backgroundColor = 'white';
    popup.style.borderWidth = '2px';
    popup.style.borderColor = 'black'
    popup.style.borderStyle = 'solid';

    if (name) {
        var closeButton = makeElement('div', 'X', null, {
            marginTop: '-3px',
            padding: '3px',
            borderStyle: 'none',
            borderLeftStyle: 'solid',
            borderWidth: '1px',
            borderColor: 'rgb(128,128,128)',
            cssFloat: 'right'
        });
        closeButton.style['float'] = 'right';
        closeButton.addEventListener('mouseover', function(ev) {
            closeButton.style.color = 'red';
        }, false);
        closeButton.addEventListener('mouseout', function(ev) {
            closeButton.style.color = 'black';
        }, false);
        closeButton.addEventListener('mousedown', function(ev) {
            thisB.removeAllPopups();
        }, false);
        var tbar = makeElement('div', [makeElement('span', name, null, {maxWidth: '200px'}), closeButton], null, {
            backgroundColor: 'rgb(230,230,250)',
            borderColor: 'rgb(128,128,128)',
            borderStyle: 'none',
            borderBottomStyle: 'solid',
            borderWidth: '1px',
            padding: '3px'
        });

        var dragOX, dragOY;
        var moveHandler, upHandler;
        moveHandler = function(ev) {
            ev.stopPropagation(); ev.preventDefault();
            left = left + (ev.clientX - dragOX);
            if (left < 8) {
                left = 8;
            } if (left > (winWidth - width - 32)) {
                left = (winWidth - width - 26);
            }
            top = top + (ev.clientY - dragOY);
            top = Math.max(10, top);
            popup.style.top = '' + top + 'px';
            popup.style.left = '' + Math.min(left, (winWidth - width - 10)) + 'px';
            dragOX = ev.clientX; dragOY = ev.clientY;
        }
        upHandler = function(ev) {
            ev.stopPropagation(); ev.preventDefault();
            window.removeEventListener('mousemove', moveHandler, false);
            window.removeEventListener('mouseup', upHandler, false);
        }
        tbar.addEventListener('mousedown', function(ev) {
            ev.preventDefault(); ev.stopPropagation();
            dragOX = ev.clientX; dragOY = ev.clientY;
            window.addEventListener('mousemove', moveHandler, false);
            window.addEventListener('mouseup', upHandler, false);
        }, false);
                              

        popup.appendChild(tbar);
    }

    popup.appendChild(makeElement('div', ele, null, {
        padding: '3px',
        clear: 'both'
    }));
    this.hPopupHolder.appendChild(popup);

    var popupHandle = {
        node: popup,
        displayed: true
    };
    popup.addEventListener('DOMNodeRemoved', function(ev) {
        popupHandle.displayed = false;
    }, false);
    return popupHandle;
}

function IconSet(uri)
{
    var req = new XMLHttpRequest();
    req.open('get', uri, false);
    req.send();
    this.icons = req.responseXML;
}

IconSet.prototype.createIcon = function(name, parent)
{
    var master = this.icons.getElementById(name);
    if (!master) {
        alert("couldn't find " + name);
        return;
    }
    var copy = document.importNode(master, true);
    parent.appendChild(copy);
    var bbox = copy.getBBox();
    parent.removeChild(copy);
    copy.setAttribute('transform', 'translate(' + (-bbox.x)  + ',' + (-bbox.y)+ ')');
    var icon = makeElementNS(NS_SVG, 'g', copy);
    return icon;
}


IconSet.prototype.createButton = function(name, parent, bx, by)
{
    bx = bx|0;
    by = by|0;

    var master = this.icons.getElementById(name);
    var copy = document.importNode(master, true);
    parent.appendChild(copy);
    var bbox = copy.getBBox();
    parent.removeChild(copy);
    copy.setAttribute('transform', 'translate(' + (((bx - bbox.width - 2)/2) - bbox.x)  + ',' + (((by - bbox.height - 2)/2) - bbox.y)+ ')');
    var button = makeElementNS(NS_SVG, 'g', [
        makeElementNS(NS_SVG, 'rect', null, {
            x: 0,
            y: 0,
            width: bx,
            height: by,
            fill: 'rgb(230,230,250)',
            stroke: 'rgb(150,150,220)',
            strokeWidth: 2
        }), 
        copy ]);
    return button;
}

function dlog(msg) {
    var logHolder = document.getElementById('log');
    if (logHolder) {
	logHolder.appendChild(makeElement('p', msg));
    }
}
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// feature-tier.js: renderers for glyphic data
//

var MIN_FEATURE_PX = 1; // FIXME: slightly higher would be nice, but requires making
                        // drawing of joined-up groups a bit smarter.   

var MIN_PADDING = 3;

var DEFAULT_SUBTIER_MAX = 25;

//
// Colour handling
//

function DColour(red, green, blue, name) {
    this.red = red|0;
    this.green = green|0;
    this.blue = blue|0;
    if (name) {
        this.name = name;
    }
}

DColour.prototype.toSvgString = function() {
    if (!this.name) {
        this.name = "rgb(" + this.red + "," + this.green + "," + this.blue + ")";
    }

    return this.name;
}

var palette = {
    red: new DColour(255, 0, 0, 'red'),
    green: new DColour(0, 255, 0, 'green'),
    blue: new DColour(0, 0, 255, 'blue'),
    yellow: new DColour(255, 255, 0, 'yellow'),
    white: new DColour(255, 255, 255, 'white'),
    black: new DColour(0, 0, 0, 'black')
};

var COLOR_RE = new RegExp('^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$');

function dasColourForName(name) {
    var c = palette[name];
    if (!c) {
        var match = COLOR_RE.exec(name);
        if (match) {
            c = new DColour(('0x' + match[1])|0, ('0x' + match[2])|0, ('0x' + match[3])|0, name);
            palette[name] = c;
        } else {
            dlog("couldn't handle color: " + name);
            c = palette.black;
            palette[name] = c;
        }
    }
    return c;
}

// 
// Wrapper for glyph plus metrics
//

function DGlyph(glyph, min, max, height) {
    this.glyph = glyph;
    this.min = min;
    this.max = max;
    this.height = height;
    this.zindex = 0;
}

//
// Set of bumped glyphs
// 

function DSubTier() {
    this.glyphs = [];
    this.height = 0;
}

DSubTier.prototype.add = function(glyph) {
    this.glyphs.push(glyph);
    this.height = Math.max(this.height, glyph.height);
}

DSubTier.prototype.hasSpaceFor = function(glyph) {
    for (var i = 0; i < this.glyphs.length; ++i) {
        var g = this.glyphs[i];
        if (g.min <= glyph.max && g.max >= glyph.min) {
            return false;
        }
    }
    return true;
}

//
// Stylesheet handling (experimental 0.5.3 version)
//

DasTier.prototype.styleForFeature = function(f) {
    // dlog('styling ' + miniJSONify(f));

    var ssScale = zoomForScale(this.browser.scale);

    if (!this.stylesheet) {
        return null;
    }

    var maybe = null;
    var ss = this.stylesheet.styles;
    for (var si = 0; si < ss.length; ++si) {
        var sh = ss[si];
        if (sh.zoom && sh.zoom != ssScale) {
            continue;
        }
        if (sh.label && !(new RegExp('^' + sh.label + '$').test(f.label))) {
            continue;
        }
        if (sh.method && !(new RegExp('^' + sh.method + '$').test(f.method))) {
            continue;
        }
        if (sh.type) {
            if (sh.type == 'default') {
                if (!maybe) {
                    maybe = sh.style;
                }
                continue;
            } else if (sh.type != f.type) {
                continue;
            }
        }
        // perfect match.
        return sh.style;
    }
    return maybe;
}

function drawLine(featureGroupElement, features, style, tier, y)
{
    var origin = tier.browser.origin, scale = tier.browser.scale;
    var height = style.HEIGHT || 30;
    var min = tier.dasSource.forceMin || style.MIN || tier.currentFeaturesMinScore || 0;
    var max = tier.dasSource.forceMax || style.MAX || tier.currentFeaturesMaxScore || 10;
    var yscale = ((1.0 * height) / (max - min));
    var width = style.LINEWIDTH || 1;
    var color = style.COLOR || style.COLOR1 || 'black';

    var path = document.createElementNS(NS_SVG, 'path');
    path.setAttribute("fill", "none");
    path.setAttribute('stroke', color);
    path.setAttribute("stroke-width", width);
    var pathOps = '';

    for (var fi = 0; fi < features.length; ++fi) {
        var f = features[fi];

        var px = ((((f.min|0) + (f.max|0)) / 2) - origin) * scale;
        var sc = ((f.score - (1.0*min)) * yscale)|0;
        var py = y + (height - sc);
        if (fi == 0) {
            pathOps = 'M ' + px + ' ' + py;
        } else {
            pathOps += ' L ' + px + ' ' + py;
        }       
    }
    path.setAttribute('d', pathOps);
    featureGroupElement.appendChild(path);

    var clipId = 'line_clip_' + (++clipIdSeed);
    var clip = document.createElementNS(NS_SVG, 'clipPath');
    clip.setAttribute('id', clipId);
    var clipRect = document.createElementNS(NS_SVG, 'rect');
    clipRect.setAttribute('x', -500000);
    clipRect.setAttribute('y', y - 1);
    clipRect.setAttribute('width', 1000000);
    clipRect.setAttribute('height', height + 2);
    clip.appendChild(clipRect);
    featureGroupElement.appendChild(clip);
    path.setAttribute('clip-path', 'url(#' + clipId + ')');
   
    if (!tier.isQuantitative) {
        tier.isQuantitative = true;
        tier.isLabelValid = false;
    }
    if (tier.min != min) {
        tier.min = min;
        tier.isLabelValid = false;
    }
    if (tier.max != max) {
        tier.max = max;
        tier.isLabelValid = false;
    }
    if (tier.clientMin != y|0 + height) {
        tier.clientMin = y|0 + height;
        tier.isLabelValid = false;
    }
    if (tier.clientMax != y) {
        tier.clientMax = y;
        tier.isLabelValid = false;
    }

    return height|0 + MIN_PADDING;
}

function sortFeatures(tier)
{
    var ungroupedFeatures = {};
    var groupedFeatures = {};
    var groups = {};
    var superGroups = {};
    var groupsToSupers = {};
    var nonPositional = [];
    var minScore, maxScore;
    var fbid;

    var init_fbid = function() {
        fbid = {};
        for (var fi = 0; fi < tier.currentFeatures.length; ++fi) {
            var f = tier.currentFeatures[fi];
            if (f.id) {
                fbid[f.id] = f;
            }
        }
    };
    
    var superParentsOf = function(f) {
        // FIXME: should recur.
        var spids = [];
        if (f.parents) {
            for (var pi = 0; pi < f.parents.length; ++pi) {
                var pid = f.parents[pi];
                var p = fbid[pid];
                if (!p) {
                    continue;
                }
                // alert(p.type + ':' + p.typeCv);
                if (p.typeCv == 'SO:0000704') {
                    pushnew(spids, pid);
                }
            }
        }
        return spids;
    }


    for (var fi = 0; fi < tier.currentFeatures.length; ++fi) {
        // var f = eval('[' + miniJSONify(tier.currentFeatures[fi]) + ']')[0]; 
        var f = tier.currentFeatures[fi];
        if (f.parts) {
            continue;
        }

        if (!f.min || !f.max) {
            nonPositional.push(f);
            continue;
        }

        if (f.score && f.score != '.' && f.score != '-') {
            sc = 1.0 * f.score;
            if (!minScore || sc < minScore) {
                minScore = sc;
            }
            if (!maxScore || sc > maxScore) {
                maxScore = sc;
            }
        }

        var fGroups = [];
        var fSuperGroup = null;
        if (f.groups) {
            for (var gi = 0; gi < f.groups.length; ++gi) {
                var g = f.groups[gi];
                var gid = g.id;
                if (g.type == 'gene') {
                    // Like a super-grouper...
                    fSuperGroup = gid; 
                    groups[gid] = shallowCopy(g);
                } else if (g.type == 'translation') {
                    // have to ignore this to get sensible results from bj-e :-(.
                } else {
                    pusho(groupedFeatures, gid, f);
                    groups[gid] = shallowCopy(g);
                    fGroups.push(gid);
                }
            }
        }

        if (f.parents) {
            if (!fbid) {
                init_fbid();
            }
            for (var pi = 0; pi < f.parents.length; ++pi) {
                var pid = f.parents[pi];
                var p = fbid[pid];
                if (!p) {
                    // alert("couldn't find " + pid);
                    continue;
                }
                if (!p.parts) {
                    p.parts = [f];
                }
                pushnewo(groupedFeatures, pid, p);
                pusho(groupedFeatures, pid, f);
                
                if (!groups[pid]) {
                    groups[pid] = {
                        type: p.type,
                        id: p.id,
                        label: p.label || p.id
                    };
                }
                fGroups.push(pid);

                var sgs = superParentsOf(p);
                if (sgs.length > 0) {
                    fSuperGroup = sgs[0];
                    var sp = fbid[sgs[0]];
                    groups[sgs[0]] = {
                        type: sp.type,
                        id: sp.id,
                        label: sp.label || sp.id
                    };
                    if (!tier.dasSource.collapseSuperGroups) {
                        tier.dasSource.collapseSuperGroups = true;
                        tier.isLabelValid = false;
                    }
                }
            }   
        }

        if (fGroups.length == 0) {
            pusho(ungroupedFeatures, f.type, f);
        } else if (fSuperGroup) {
            for (var g = 0; g < fGroups.length; ++g) {
                var gid = fGroups[g];
                pushnewo(superGroups, fSuperGroup, gid);
                groupsToSupers[gid] = fSuperGroup;
            } 
        }       
    }

    tier.ungroupedFeatures = ungroupedFeatures;
    tier.groupedFeatures = groupedFeatures;
    tier.groups = groups;
    tier.superGroups = superGroups;
    tier.groupsToSupers = groupsToSupers;

    if (minScore) {
        if (minScore > 0) {
            minScore = 0;
        } else if (maxScore < 0) {
            maxScore = 0;
        }
        tier.currentFeaturesMinScore = minScore;
        tier.currentFeaturesMaxScore = maxScore;
    }
}

var clipIdSeed = 0;

function drawFeatureTier(tier)
{
    sortFeatures(tier);
    tier.placard = null;
    tier.isQuantitative = false;         // gets reset later if we have any HISTOGRAMs.

    var featureGroupElement = tier.viewport;
    while (featureGroupElement.childNodes.length > 0) {
        featureGroupElement.removeChild(featureGroupElement.firstChild);
    }
    featureGroupElement.appendChild(tier.background);
    drawGuidelines(tier, featureGroupElement);
        
    var lh = MIN_PADDING;
    var glyphs = [];
    var specials = false;

    // Glyphify ungrouped.
        
    for (var uft in tier.ungroupedFeatures) {
        var ufl = tier.ungroupedFeatures[uft];
        // var style = styles[uft] || styles['default'];
        var style = tier.styleForFeature(ufl[0]);   // FIXME this isn't quite right...
        if (!style) continue;
        if (style.glyph == 'LINEPLOT') {
            lh += Math.max(drawLine(featureGroupElement, ufl, style, tier, lh));
            specials = true;
        } else {
            for (var pgid = 0; pgid < ufl.length; ++pgid) {
                var f = ufl[pgid];
                if (f.parts) {  // FIXME shouldn't really be needed
                    continue;
                }
                var g = glyphForFeature(f, 0, tier.styleForFeature(f), tier);
                glyphs.push(g);
            }
        }
    }

    // Merge supergroups
    
    if (tier.dasSource.collapseSuperGroups && !tier.bumped) {
        for (var sg in tier.superGroups) {
            var sgg = tier.superGroups[sg];
            tier.groups[sg].type = tier.groups[sgg[0]].type;   // HACK to make styling easier in DAS1.6
            var featsByType = {};
            for (var g = 0; g < sgg.length; ++g) {
                var gf = tier.groupedFeatures[sgg[g]];
                for (var fi = 0; fi < gf.length; ++fi) {
                    var f = gf[fi];
                    pusho(featsByType, f.type, f);
                }

                if (tier.groups[sg] && !tier.groups[sg].links || tier.groups[sg].links.length == 0) {
                    tier.groups[sg].links = tier.groups[sgg[0]].links;
                }

                delete tier.groupedFeatures[sgg[g]];  // 'cos we don't want to render the unmerged version.
            }

            for (var t in featsByType) {
                var feats = featsByType[t];
                var template = feats[0];
                var loc = null;
                for (var fi = 0; fi < feats.length; ++fi) {
                    var f = feats[fi];
                    var fl = new Range(f.min, f.max);
                    if (!loc) {
                        loc = fl;
                    } else {
                        loc = union(loc, fl);
                    }
                }
                var mergedRanges = loc.ranges();
                for (var si = 0; si < mergedRanges.length; ++si) {
                    var r = mergedRanges[si];

                    // begin coverage-counting
                    var posCoverage = ((r.max()|0) - (r.min()|0) + 1) * sgg.length;
                    var actCoverage = 0;
                    for (var fi = 0; fi < feats.length; ++fi) {
                        var f = feats[fi];
                        if ((f.min|0) <= r.max() && (f.max|0) >= r.min()) {
                            var umin = Math.max(f.min|0, r.min());
                            var umax = Math.min(f.max|0, r.max());
                            actCoverage += (umax - umin + 1);
                        }
                    }
                    var visualWeight = ((1.0 * actCoverage) / posCoverage);
                    // end coverage-counting

                    var newf = new DASFeature();
                    for (k in template) {
                        newf[k] = template[k];
                    }
                    newf.min = r.min();
                    newf.max = r.max();
                    if (newf.label && sgg.length > 1) {
                        newf.label += ' (' + sgg.length + ' vars)';
                    }
                    newf.visualWeight = ((1.0 * actCoverage) / posCoverage);
                    pusho(tier.groupedFeatures, sg, newf);
                    // supergroups are already in tier.groups.
                }
            }

            delete tier.superGroups[sg]; // Do we want this?
        }       
    }

    // Glyphify groups.

    var gl = new Array();
    for (var gid in tier.groupedFeatures) {
        gl.push(gid);
    }
    gl.sort(function(g1, g2) {
        var d = tier.groupedFeatures[g1][0].score - tier.groupedFeatures[g2][0].score;
        if (d > 0) {
            return -1;
        } else if (d == 0) {
            return 0;
        } else {
            return 1;
        }
    });

    var groupGlyphs = {};
    for (var gx = 0; gx < gl.length; ++gx) {
        var gid = gl[gx];
        var g = glyphsForGroup(tier.groupedFeatures[gid], 0, tier.groups[gid], tier,
                               (tier.dasSource.collapseSuperGroups && !tier.bumped) ? 'collapsed_gene' : 'tent');
        if (g) {
            groupGlyphs[gid] = g;
        }
    }

    for (var sg in tier.superGroups) {
        var sgg = tier.superGroups[sg];
        var sgGlyphs = [];
        var sgMin = 10000000000;
        var sgMax = -10000000000;
        for (var sgi = 0; sgi < sgg.length; ++sgi) {
            var gg = groupGlyphs[sgg[sgi]];
            groupGlyphs[sgg[sgi]] = null;
            if (gg) {
                sgGlyphs.push(gg);
                sgMin = Math.min(sgMin, gg.min);
                sgMax = Math.max(sgMax, gg.max);
            }
        }
        for (var sgi = 0; sgi < sgGlyphs.length; ++sgi) {
            var gg = sgGlyphs[sgi];
            gg.min = sgMin;
            gg.max = sgMax;
            glyphs.push(gg);
        }
    }
    for (var g in groupGlyphs) {
        var gg = groupGlyphs[g];
        if (gg) {
            glyphs.push(gg);
        }
    }

    var unbumpedST = new DSubTier();
    var bumpedSTs = [];
    var hasBumpedFeatures = false;
    var subtierMax = tier.dasSource.subtierMax || DEFAULT_SUBTIER_MAX;
    
  GLYPH_LOOP:
    for (var i = 0; i < glyphs.length; ++i) {
        var g = glyphs[i];
        g = labelGlyph(tier, g, featureGroupElement);
        if (g.bump) {
            hasBumpedFeatures = true;
        }
        if (g.bump && (tier.bumped || tier.dasSource.collapseSuperGroups)) {       // kind-of nasty.  supergroup collapsing is different from "normal" unbumping
            for (var sti = 0; sti < bumpedSTs.length;  ++sti) {
                var st = bumpedSTs[sti];
                if (st.hasSpaceFor(g)) {
                    st.add(g);
                    continue GLYPH_LOOP;
                }
            }
            if (bumpedSTs.length >= subtierMax) {
                tier.status = 'Too many overlapping features, truncating at ' + subtierMax;
            } else {
                var st = new DSubTier();
                st.add(g);
                bumpedSTs.push(st);
            }
        } else {
            unbumpedST.add(g);
        }
    }

    tier.hasBumpedFeatures = hasBumpedFeatures;

    if (unbumpedST.glyphs.length > 0) {
        bumpedSTs = [unbumpedST].concat(bumpedSTs);
    }

    var stBoundaries = [];
    if (specials) {
        stBoundaries.push(lh);
    } 
    for (var bsi = 0; bsi < bumpedSTs.length; ++bsi) {
        var st = bumpedSTs[bsi];
        var stg = st.glyphs;
        stg = stg.sort(function(g1, g2) {
            return g1.zindex - g2.zindex;
        });

	for (var i = 0; i < stg.length; ++i) {
	    var g = stg[i];
	    if (g.glyph) {
                gypos = lh;
                if (g.height < st.height) {
                    gypos += (st.height - g.height);
                }
		g.glyph.setAttribute('transform', 'translate(0, ' + gypos + ')');
                g.glyph.setAttribute('cursor', 'pointer');
                featureGroupElement.appendChild(g.glyph);
            }
        }
        
        if (g.quant) {
            tier.isLabelValid = false;    // FIXME
            tier.isQuantitative = true;
            tier.min = g.quant.min;
            tier.max = g.quant.max;
            tier.clientMin = lh + st.height;
            tier.clientMax = lh;
        }

        lh += st.height + MIN_PADDING;
        stBoundaries.push(lh);
    }

    lh = Math.max(tier.browser.minTierHeight, lh); // for sanity's sake.
    if (stBoundaries.length < 2) {
        var bumped = false;
        var minHeight = lh;
        
        var ss = tier.stylesheet;
        if (ss) {
            var ssScale = zoomForScale(tier.browser.scale);
            for (var si = 0; si < ss.styles.length; ++si) {
                var sh = ss.styles[si];
                if (!sh.zoom || sh.zoom == ssScale) {
                    var s = sh.style;
                     if (s.bump) {
                         bumped = true;
                     }
                    if (s.height && (4.0 + s.height) > minHeight) {
                        minHeight = (4.0 + s.height);
                    }
                }
            }
            if (bumped) {
                lh = 2 * minHeight;
            }
        }
    }                   

    tier.wantedLayoutHeight = lh;
    if (!tier.layoutWasDone || tier.browser.autoSizeTiers) {
        tier.layoutHeight = lh;
        if (glyphs.length > 0 || specials) {
            tier.layoutWasDone = true;
        }
        tier.placard = null;
    } else {
        if (tier.layoutHeight != lh) {
            var spandPlacard = document.createElementNS(NS_SVG, 'g');
            var frame = document.createElementNS(NS_SVG, 'rect');
            frame.setAttribute('x', 0);
            frame.setAttribute('y', -20);
            frame.setAttribute('width', tier.browser.featurePanelWidth);
            frame.setAttribute('height', 20);
            frame.setAttribute('stroke', 'red');
            frame.setAttribute('stroke-width', 1);
            frame.setAttribute('fill', 'white');
            spandPlacard.appendChild(frame);
            var spand = document.createElementNS(NS_SVG, 'text');
            spand.setAttribute('stroke', 'none');
            spand.setAttribute('fill', 'red');
            spand.setAttribute('font-family', 'helvetica');
            spand.setAttribute('font-size', '10pt');

            if (tier.layoutHeight < lh) { 
                var dispST = 0;
                while ((tier.layoutHeight - 20) >= stBoundaries[dispST]) { // NB allowance for placard!
                    ++dispST;
                }
                spand.appendChild(document.createTextNode('Show ' + (stBoundaries.length - dispST) + ' more'));
            } else {
                spand.appendChild(document.createTextNode('Show less'));
            }
            
            spand.setAttribute('x', 80);
            spand.setAttribute('y', -6);
            spandPlacard.appendChild(spand);
            var arrow = document.createElementNS(NS_SVG, 'path');
            arrow.setAttribute('fill', 'red');
            arrow.setAttribute('stroke', 'none');
            if (tier.layoutHeight < lh) {
                arrow.setAttribute('d', 'M ' +  30 + ' ' + -16 +
                                   ' L ' + 42 + ' ' + -16 +
                                   ' L ' + 36 + ' ' + -4 + ' Z');
            } else {
                arrow.setAttribute('d', 'M ' +  30 + ' ' + -4 +
                                   ' L ' + 42 + ' ' + -4 +
                                   ' L ' + 36 + ' ' + -16 + ' Z');
            }
            spandPlacard.appendChild(arrow);
            
            spandPlacard.addEventListener('mousedown', function(ev) {
                tier.layoutHeight = tier.wantedLayoutHeight;
                tier.placard = null;
                tier.clipTier();
                tier.browser.arrangeTiers();
            }, false);

            var dismiss = document.createElementNS(NS_SVG, 'text');
            dismiss.setAttribute('stroke', 'none');
            dismiss.setAttribute('fill', 'red');
            dismiss.setAttribute('font-family', 'helvetica');
            dismiss.setAttribute('font-size', '10pt');
            dismiss.appendChild(document.createTextNode("(Auto grow-shrink)"));
            dismiss.setAttribute('x', 750);
            dismiss.setAttribute('y', -6);
            dismiss.addEventListener('mousedown', function(ev) {
                ev.preventDefault(); ev.stopPropagation();
                tier.browser.autoSizeTiers = true;
                tier.browser.refresh();
            }, false);
            spandPlacard.appendChild(dismiss);

            tier.placard = spandPlacard;
        } 
    }

    var statusMsg = tier.error || tier.status;
    if (statusMsg != null) {
        var statusPlacard = document.createElementNS(NS_SVG, 'g');
        var frame = document.createElementNS(NS_SVG, 'rect');
        frame.setAttribute('x', 0);
        frame.setAttribute('y', -20);
        frame.setAttribute('width', tier.browser.featurePanelWidth);
        frame.setAttribute('height', 20);
        frame.setAttribute('stroke', 'red');
        frame.setAttribute('stroke-width', 1);
        frame.setAttribute('fill', 'white');
        statusPlacard.appendChild(frame);
        var status = document.createElementNS(NS_SVG, 'text');
        status.setAttribute('stroke', 'none');
        status.setAttribute('fill', 'red');
        status.setAttribute('font-family', 'helvetica');
        status.setAttribute('font-size', '10pt');
        status.setAttribute('x', 25);
        status.setAttribute('y', -6);
        status.appendChild(document.createTextNode(statusMsg));

        if (tier.error) {
            var dismiss = document.createElementNS(NS_SVG, 'text');
            dismiss.setAttribute('stroke', 'none');
            dismiss.setAttribute('fill', 'red');
            dismiss.setAttribute('font-family', 'helvetica');
            dismiss.setAttribute('font-size', '10pt');
            dismiss.appendChild(document.createTextNode("(Remove track)"));
            dismiss.setAttribute('x', 800);
            dismiss.setAttribute('y', -6);
            dismiss.addEventListener('mousedown', function(ev) {
                ev.preventDefault(); ev.stopPropagation();
                // dlog('Remove');
                tier.browser.removeTier(tier);
            }, false);
            statusPlacard.appendChild(dismiss);
        }

        statusPlacard.appendChild(status);
        tier.placard = statusPlacard;
    }

    tier.clipTier();
            
    tier.scale = 1;
}

DasTier.prototype.clipTier = function() {
    var featureGroupElement = this.viewport;

    this.background.setAttribute("height", this.layoutHeight);

    var clipId = 'tier_clip_' + (++clipIdSeed);
    var clip = document.createElementNS(NS_SVG, 'clipPath');
    clip.setAttribute('id', clipId);
    var clipRect = document.createElementNS(NS_SVG, 'rect');
    clipRect.setAttribute('x', -500000);
    clipRect.setAttribute('y', 0);
    clipRect.setAttribute('width', 1000000);
    clipRect.setAttribute('height', this.layoutHeight);
    clip.appendChild(clipRect);
    featureGroupElement.appendChild(clip);
    featureGroupElement.setAttribute('clip-path', 'url(#' + clipId + ')');
}

function glyphsForGroup(features, y, groupElement, tier, connectorType) {
    var scale = tier.browser.scale, origin = tier.browser.origin;
    var height=1;
    var label;
    var links = null;
    var notes = null;
    var spans = null;
    var strand = null;
    var quant = null;
    var consHeight;
    var gstyle = tier.styleForFeature(groupElement);
    

    for (var i = 0; i < features.length; ++i) {
        var feature = features[i];
        // var style = stylesheet[feature.type] || stylesheet['default'];
        var style = tier.styleForFeature(feature);
        if (!style) {
            continue;
        }
        if (style.HEIGHT) {
            if (!consHeight) {
                consHeight = style.HEIGHT|0;
            } else {
                consHeight = Math.max(consHeight, style.HEIGHT|0);
            }
        }
    }
  
    var glyphGroup = document.createElementNS(NS_SVG, 'g');
    var glyphChildren = [];
    glyphGroup.dalliance_group = groupElement;
    var featureDGlyphs = [];
    for (var i = 0; i < features.length; ++i) {
        var feature = features[i];
        if (feature.orientation && strand==null) {
            strand = feature.orientation;
        }
        if (feature.notes && notes==null) {
            notes = feature.notes;
        }
        if (feature.links && links==null) {
            links = feature.links;
        }
        // var style = stylesheet[feature.type] || stylesheet['default'];
        var style = tier.styleForFeature(feature);
        if (!style) {
            continue;
        }
        if (feature.parts) {  // FIXME shouldn't really be needed
            continue;
        }
        var glyph = glyphForFeature(feature, y, style, tier, consHeight);
        if (glyph && glyph.glyph) {
            featureDGlyphs.push(glyph);
        }
    }
    if (featureDGlyphs.length == 0) {
        return null;
    }

    featureDGlyphs = featureDGlyphs.sort(function(g1, g2) {
        return g1.zindex - g2.zindex;
    });
    
    for (var i = 0; i < featureDGlyphs.length; ++i) {
        var glyph = featureDGlyphs[i];
        glyph.glyph.dalliance_group = groupElement;
        // glyphGroup.appendChild(glyph.glyph);
        glyphChildren.push(glyph.glyph);
        var gspan = new Range(glyph.min, glyph.max);
        if (spans == null) {
            spans = gspan;
        } else {
            spans = union(spans, gspan);
        }
        height = Math.max(height, glyph.height);
        if (!label && glyph.label) {
            label = glyph.label;
        }
        if (glyph.quant) {
            quant = glyph.quant;
        }
    }

    if (spans) {
        var blockList = spans.ranges();
        for (var i = 1; i < blockList.length; ++i) {
            var lmin = ((blockList[i - 1].max() + 1 - origin) * scale);
            var lmax = (blockList[i].min() - origin) * scale;

            var path;
            if (connectorType == 'collapsed_gene') {
                path = document.createElementNS(NS_SVG, 'path');
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', 'black');
                path.setAttribute('stroke-width', '1');
                
                var hh = height/2;
                var pathops = "M " + lmin + " " + (y + hh) + " L " + lmax + " " + (y + hh);
                if (lmax - lmin > 8) {
                    var lmid = (0.5*lmax) + (0.5*lmin);
                    if (strand == '+') {
                        pathops += ' M ' + (lmid - 2) + ' ' + (y+hh-4) +
                            ' L ' + (lmid + 2) + ' ' + (y+hh) +
                            ' L ' + (lmid - 2) + ' ' + (y+hh+4); 
                    } else if (strand == '-') {
                        pathops += ' M ' + (lmid + 2) + ' ' + (y+hh-4) +
                            ' L ' + (lmid - 2) + ' ' + (y+hh) +
                            ' L ' + (lmid + 2) + ' ' + (y+hh+4); 
                    }
                }
                path.setAttribute('d', pathops);
            } else {
                path = document.createElementNS(NS_SVG, 'path');
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', 'black');
                path.setAttribute('stroke-width', '1');
                
                var vee = true;
                if (gstyle && gstyle.STYLE && gstyle.STYLE != 'hat') {
                    vee = false;
                }

                var hh;
                if (quant) {
                    hh = height;  // HACK to give ensembl-like behaviour for grouped histograms.
                } else {
                    hh = height/2;
                }
                if (vee && (strand == "+" || strand == "-")) {
                    var lmid = (lmin + lmax) / 2;
                    var lmidy = (strand == "-") ? y + 12 : y;
                    path.setAttribute("d", "M " + lmin + " " + (y + hh) + " L " + lmid + " " + lmidy + " L " + lmax + " " + (y + hh));
                } else {
                    path.setAttribute("d", "M " + lmin + " " + (y + hh) + " L " + lmax + " " + (y + hh));
                }
            }
            glyphGroup.appendChild(path);
        }
    }

    for (var i = 0; i < glyphChildren.length; ++i) {
        glyphGroup.appendChild(glyphChildren[i]);
    }

    groupElement.segment = features[0].segment;
    groupElement.min = spans.min();
    groupElement.max = spans.max();
    if (notes && (!groupElement.notes || groupElement.notes.length==0)) {
        groupElement.notes = notes;
    }

    var dg = new DGlyph(glyphGroup, spans.min(), spans.max(), height);
    dg.strand = strand;
    dg.bump = true; // grouped features always bumped.
    // alert(miniJSONify(gstyle));
    if (label || (gstyle && (gstyle.LABEL || gstyle.LABELS))) {  // HACK, LABELS should work.
        dg.label = groupElement.label || label;
        var sg = tier.groupsToSupers[groupElement.id];
        if (sg && tier.superGroups[sg]) {    // workaround case where group and supergroup IDs match.
            if (groupElement.id != tier.superGroups[sg][0]) {
                dg.label = null;
            }
        }
    }
    if (quant) {
        dg.quant = quant;
    }
    return dg;
}

function glyphForFeature(feature, y, style, tier, forceHeight)
{
    var scale = tier.browser.scale, origin = tier.browser.origin;
    var gtype = style.glyph || 'BOX';
    var glyph;
    var min = feature.min;
    var max = feature.max;
    var type = feature.type;
    var strand = feature.orientation;
    var score = feature.score;
    var label = feature.label;

    var minPos = (min - origin) * scale;
    var maxPos = ((max - origin + 1) * scale);

    var requiredHeight;
    var quant;

    if (gtype == 'HIDDEN' || feature.parts) {
        glyph = null;
    } else if (gtype == 'CROSS' || gtype == 'EX' || gtype == 'SPAN' || gtype == 'LINE' || gtype == 'DOT' || gtype == 'TRIANGLE') {
        var stroke = style.FGCOLOR || 'black';
        var fill = style.BGCOLOR || 'none';
        var height = style.HEIGHT || forceHeight || 12;
        requiredHeight = height = 1.0 * height;

        var mid = (minPos + maxPos)/2;
        var hh = height/2;

        var mark;
        var bMinPos = minPos, bMaxPos = maxPos;

        if (gtype == 'CROSS') {
            mark = document.createElementNS(NS_SVG, 'path');
            mark.setAttribute('fill', 'none');
            mark.setAttribute('stroke', stroke);
            mark.setAttribute('stroke-width', 1);
            mark.setAttribute('d', 'M ' + (mid-hh) + ' ' + (y+hh) + 
                              ' L ' + (mid+hh) + ' ' + (y+hh) + 
                              ' M ' + mid + ' ' + y +
                              ' L ' + mid + ' ' + (y+height));
            bMinPos = Math.min(minPos, mid-hh);
            bMaxPos = Math.max(maxPos, mid+hh);
        } else if (gtype == 'EX') {
            mark = document.createElementNS(NS_SVG, 'path');
            mark.setAttribute('fill', 'none');
            mark.setAttribute('stroke', stroke);
            mark.setAttribute('stroke-width', 1);
            mark.setAttribute('d', 'M ' + (mid-hh) + ' ' + (y) + 
                              ' L ' + (mid+hh) + ' ' + (y+height) + 
                              ' M ' + (mid+hh) + ' ' + (y) +
                              ' L ' + (mid-hh) + ' ' + (y+height));  
            bMinPos = Math.min(minPos, mid-hh);
            bMaxPos = Math.max(maxPos, mid+hh);
        } else if (gtype == 'SPAN') {
            mark = document.createElementNS(NS_SVG, 'path');
            mark.setAttribute('fill', 'none');
            mark.setAttribute('stroke', stroke);
            mark.setAttribute('stroke-width', 1);
            mark.setAttribute('d', 'M ' + minPos + ' ' + (y+hh) +
                              ' L ' + maxPos + ' ' + (y+hh) +
                              ' M ' + minPos + ' ' + y +
                              ' L ' + minPos + ' ' + (y + height) +
                              ' M ' + maxPos + ' ' + y +
                              ' L ' + maxPos + ' ' + (y + height));
        } else if (gtype == 'LINE') {
            var lstyle = style.STYLE || 'solid';
            mark = document.createElementNS(NS_SVG, 'path');
            mark.setAttribute('fill', 'none');
            mark.setAttribute('stroke', stroke);
            mark.setAttribute('stroke-width', 1);
            if (lstyle == 'hat') {
                var dip = 0;
                if (feature.orientation == '-') {
                    dip = height;
                }
                mark.setAttribute('d', 'M ' + minPos + ' ' + (y+hh) +
                                  ' L ' + ((maxPos + minPos) / 2) + ' ' + (y+dip) +
                                  ' L ' + maxPos + ' ' + (y+hh));
            } else {
                mark.setAttribute('d', 'M ' + minPos + ' ' + (y+hh) +
                                  ' L ' + maxPos + ' ' + (y+hh));
            }
            if (lstyle == 'dashed') {
                mark.setAttribute('stroke-dasharray', '3');
            }
        } else if (gtype == 'DOT') {
            mark = document.createElementNS(NS_SVG, 'circle');
            mark.setAttribute('fill', stroke);   // yes, really...
            mark.setAttribute('stroke', 'none');
            mark.setAttribute('cx', mid);
            mark.setAttribute('cy', (y+hh));
            mark.setAttribute('r', hh);
            bMinPos = Math.min(minPos, mid-hh);
            bMaxPos = Math.max(maxPos, mid+hh);
        }  else if (gtype == 'TRIANGLE') {
            var dir = style.DIRECTION || 'N';
            if (dir === 'FORWARD') {
                if (strand === '-') {
                    dir = 'W';
                } else {
                    dir = 'E';
                }
            } else if (dir === 'REVERSE') {
                if (strand === '-') {
                    dir = 'E';
                } else {
                    dir = 'W';
                }
            }
            var width = style.LINEWIDTH || height;
            halfHeight = 0.5 * height;
            halfWidth = 0.5 * width;
            mark = document.createElementNS(NS_SVG, 'path');
            if (dir == 'E') {
            mark.setAttribute('d', 'M ' + (mid - halfWidth) + ' ' + 0 + 
                              ' L ' + (mid - halfWidth) + ' ' + height +
                              ' L ' + (mid + halfWidth) + ' ' + halfHeight + ' Z');
            } else if (dir == 'W') {
                mark.setAttribute('d', 'M ' + (mid + halfWidth) + ' ' + 0 + 
                                  ' L ' + (mid + halfWidth) + ' ' + height +
                                  ' L ' + (mid - halfWidth) + ' ' + halfHeight + ' Z');
            } else if (dir == 'S') {
                
                mark.setAttribute('d', 'M ' + (mid + halfWidth) + ' ' + 0 + 
                                  ' L ' + (mid - halfWidth) + ' ' + 0 +
                                  ' L ' + mid + ' ' + height + ' Z');
            } else {
                mark.setAttribute('d', 'M ' + (mid + halfWidth) + ' ' + height + 
                                  ' L ' + (mid - halfWidth) + ' ' + height +
                                  ' L ' + mid + ' ' + 0 + ' Z');
            }
            bMinPos = Math.min(minPos, mid-halfWidth);
            bMaxPos = Math.max(maxPos, mid+halfWidth);
            mark.setAttribute('fill', stroke);
            mark.setAttribute('stroke', 'none');
        }

        glyph = document.createElementNS(NS_SVG, 'g');
        if (fill == 'none' || bMinPos < minPos || bMaxPos > maxPos) {
            var bg = document.createElementNS(NS_SVG, 'rect');
            bg.setAttribute('x', bMinPos);
            bg.setAttribute('y', y);
            bg.setAttribute('width', bMaxPos - bMinPos);
            bg.setAttribute('height', height);
            bg.setAttribute('stroke', 'none');
            bg.setAttribute('fill', 'none');
            bg.setAttribute('pointer-events', 'all');
            glyph.appendChild(bg);
        }
        if (fill != 'none') {
            var bg = document.createElementNS(NS_SVG, 'rect');
            bg.setAttribute('x', minPos);
            bg.setAttribute('y', y);
            bg.setAttribute('width', maxPos - minPos);
            bg.setAttribute('height', height);
            bg.setAttribute('stroke', 'none');
            bg.setAttribute('fill', fill);
            bg.setAttribute('pointer-events', 'all');
            glyph.appendChild(bg);
        }
        glyph.appendChild(mark);
/*
        if (bMinPos < minPos) {
            min = bMinPos/scale + origin;
        } 
        if (bMaxPos > maxPos) {
            max = (bMaxPos-1)/scale + origin;
        } */
    } else if (gtype == 'PRIMERS') {
        var arrowColor = style.FGCOLOR || 'red';
        var lineColor = style.BGCOLOR || 'black';
        var height = style.HEIGHT || forceHeight || 12;
        requiredHeight = height = 1.0 * height;

        var mid = (minPos + maxPos)/2;
        var hh = height/2;

        var glyph = document.createElementNS(NS_SVG, 'g');
        var line = document.createElementNS(NS_SVG, 'path');
        line.setAttribute('stroke', lineColor);
        line.setAttribute('fill', 'none');
        line.setAttribute('d', 'M ' + minPos + ' ' + (height/2) + ' L ' + maxPos + ' ' + (height/2));
        glyph.appendChild(line);

        var trigs = document.createElementNS(NS_SVG, 'path');
        trigs.setAttribute('stroke', 'none');
        trigs.setAttribute('fill', 'arrowColor');
        trigs.setAttribute('d', 'M ' + minPos + ' ' + 0 + ' L ' + minPos + ' ' + height + ' L ' + (minPos + height) + ' ' + (height/2) + ' Z ' +
                                'M ' + maxPos + ' ' + 0 + ' L ' + maxPos + ' ' + height + ' L ' + (maxPos - height) + ' ' + (height/2) + ' Z');
        glyph.appendChild(trigs);
    } else if (gtype == 'ARROW') {
        var parallel = style.PARALLEL ? style.PARALLEL == 'yes' : true;
        var ne = style.NORTHEAST && style.NORTHEAST == 'yes';
        var sw = style.SOUTHWEST && style.SOUTHWEST == 'yes';

        var stroke = style.FGCOLOR || 'none';
        var fill = style.BGCOLOR || 'green';
        var height = style.HEIGHT || forceHeight || 12;
        requiredHeight = height = 1.0 * height;
        var headInset = parallel ? 0.5 *height : 0.25 * height;
        var midPos = (maxPos + minPos)/2;
        var instep = parallel ? 0.25 * height : 0.4 * height;
        
        if (parallel) {
            if (ne && (maxPos - midPos < height)) {
                maxPos = midPos + height;
            }
            if (sw && (midPos - minPos < height)) {
                minPos = midPos - height;
            }
        } else {
            if (maxPos - minPos < (0.75 * height)) {
                minPos = midPos - (0.375 * height);
                maxPos = midPos + (0.375 * height);
            }
        }

        var path = document.createElementNS(NS_SVG, 'path');
        path.setAttribute('fill', fill);
        path.setAttribute('stroke', stroke);
        if (stroke != 'none') {
            path.setAttribute('stroke-width', 1);
        }

        var pathops;
        if (parallel) {
            pathops = 'M ' + midPos + ' ' + instep;
            if (ne) {
                pathops += ' L ' + (maxPos - headInset) + ' ' + instep + 
                    ' L ' + (maxPos - headInset) + ' 0' +
                    ' L ' + maxPos + ' ' + (height/2) +
                    ' L ' + (maxPos - headInset) + ' ' + height +
                    ' L ' + (maxPos - headInset) + ' ' + (height - instep);
            } else {
                pathops += ' L ' + maxPos + ' ' + instep +
                    ' L ' + maxPos + ' ' + (height - instep);
            }
            if (sw) {
                pathops += ' L ' + (minPos + headInset) + ' ' + (height-instep) +
                    ' L ' + (minPos + headInset) + ' ' + height + 
                    ' L ' + minPos + ' ' + (height/2) +
                    ' L ' + (minPos + headInset) + ' ' + ' 0' +
                    ' L ' + (minPos + headInset) + ' ' + instep;
            } else {
                pathops += ' L ' + minPos + ' ' + (height-instep) +
                    ' L ' + minPos + ' ' + instep;
            }
            pathops += ' Z';
        } else {
            pathops = 'M ' + (minPos + instep) + ' ' + (height/2);
            if (ne) {
                pathops += ' L ' + (minPos + instep) + ' ' + headInset +
                    ' L ' + minPos + ' ' + headInset +
                    ' L ' + midPos + ' 0' +
                    ' L ' + maxPos + ' ' + headInset +
                    ' L ' + (maxPos - instep) + ' ' + headInset;
            } else {
                pathops += ' L ' + (minPos + instep) + ' 0' +
                    ' L ' + (maxPos - instep) + ' 0';
            }
            if (sw) {
                pathops += ' L ' + (maxPos - instep) + ' ' + (height - headInset) +
                    ' L ' + maxPos + ' ' + (height - headInset) +
                    ' L ' + midPos + ' ' + height + 
                    ' L ' + minPos + ' ' + (height - headInset) +
                    ' L ' + (minPos + instep) + ' ' + (height - headInset);
            } else {
                pathops += ' L ' + (maxPos - instep) + ' ' + height +
                    ' L ' + (minPos + instep) + ' ' + height;
            }
            pathops += ' Z';
        }
        path.setAttribute('d', pathops);

        glyph = path;
    } else if (gtype == 'ANCHORED_ARROW') {
        var stroke = style.FGCOLOR || 'none';
        var fill = style.BGCOLOR || 'green';
        var height = style.HEIGHT || forceHeight || 12;
        requiredHeight = height = 1.0 * height;
        var lInset = 0;
        var rInset = 0;
        var minLength = height + 2;
        var instep = 0.333333 * height;
        

        if (feature.orientation) {
            if (feature.orientation == '+') {
                rInset = height/2;
            } else if (feature.orientation == '-') {
                lInset = height/2;
            }
        }

        if (maxPos - minPos < minLength) {
            minPos = (maxPos + minPos - minLength) / 2;
            maxPos = minPos + minLength;
        }

        var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("fill", fill);
        path.setAttribute('stroke', stroke);
        if (stroke != 'none') {
            path.setAttribute("stroke-width", 1);
        }
        
        path.setAttribute('d', 'M ' + ((minPos + lInset)) + ' ' + ((y+instep)) +
                          ' L ' + ((maxPos - rInset)) + ' ' + ((y+instep)) +
                          ' L ' + ((maxPos - rInset)) + ' ' + (y) +
                          ' L ' + (maxPos) + ' ' + ((y+(height/2))) +
                          ' L ' + ((maxPos - rInset)) + ' ' + ((y+height)) +
                          ' L ' + ((maxPos - rInset)) + ' ' + ((y + instep + instep)) +
                          ' L ' + ((minPos + lInset)) + ' ' + ((y + instep + instep)) +
                          ' L ' + ((minPos + lInset)) + ' ' + ((y + height)) +
                          ' L ' + (minPos) + ' ' + ((y+(height/2))) +
                          ' L ' + ((minPos + lInset)) + ' ' + (y) +
                          ' L ' + ((minPos + lInset)) + ' ' + ((y+instep)));

        glyph = path;
    } else if (gtype == 'TEXT') {
        var textFill = style.FGCOLOR || 'none';
        var bgFill = style.BGCOLOR || 'none';
        var height = style.HEIGHT || forceHeight || 12;
        var tstring = style.STRING;
        requiredHeight = height;
        if (!tstring) {
            glyph = null;
        } else {
            var txt = makeElementNS(NS_SVG, 'text', tstring, {
                stroke: 'none',
                fill: textFill
            });
            tier.viewport.appendChild(txt);
            var bbox = txt.getBBox();
            tier.viewport.removeChild(txt);
            txt.setAttribute('x', (minPos + maxPos - bbox.width)/2);
            txt.setAttribute('y', height - 2);

            if (bgFill == 'none') {
                glyph = txt;
            } else {
                glyph = makeElementNS(NS_SVG, 'g', [
                    makeElementNS(NS_SVG, 'rect', null, {
                        x: minPos,
                        y: 0,
                        width: (maxPos - minPos),
                        height: height,
                        fill: bgFill,
                        stroke: 'none'
                    }),
                    txt]);
            }

            if (bbox.width > (maxPos - minPos)) {
                var tMinPos = (minPos + maxPos - bbox.width)/2;
                var tMaxPos = minPos + bbox.width;
                min = ((tMinPos/scale)|0) + origin;
                max = ((tMaxPos/scale)|0) + origin;
            }
        }
    } else {
        // BOX plus other rectangular stuff
        // Also handles HISTOGRAM, GRADIENT, and TOOMANY.
    
        var stroke = style.FGCOLOR || 'none';
        var fill = feature.override_color || style.BGCOLOR || style.COLOR1 || 'green';
        var height = style.HEIGHT || forceHeight || 12;
        requiredHeight = height = 1.0 * height;

        if (style.WIDTH) {
            var w = style.WIDTH|0;
            minPos = (maxPos + minPos - w) / 2;
            maxPos = minPos + w;
        } else if (maxPos - minPos < MIN_FEATURE_PX) {
            minPos = (maxPos + minPos - MIN_FEATURE_PX) / 2;
            maxPos = minPos + MIN_FEATURE_PX;
        }

        if ((gtype == 'HISTOGRAM' || gtype == 'GRADIENT') && score !== 'undefined') {
            var smin = tier.dasSource.forceMin || style.MIN || tier.currentFeaturesMinScore;
            var smax = tier.dasSource.forceMax || style.MAX || tier.currentFeaturesMaxScore;

            if (!smax) {
                if (smin < 0) {
                    smax = 0;
                } else {
                    smax = 10;
                }
            }
            if (!smin) {
                smin = 0;
            }

            if ((1.0 * score) < (1.0 *smin)) {
                score = smin;
            }
            if ((1.0 * score) > (1.0 * smax)) {
                score = smax;
            }
            var relScore = ((1.0 * score) - smin) / (smax-smin);

            if (style.COLOR2) {
                var loc, hic, frac;
                if (style.COLOR3) {
                    if (relScore < 0.5) {
                        loc = dasColourForName(style.COLOR1);
                        hic = dasColourForName(style.COLOR2);
                        frac = relScore * 2;
                    } else {
                        loc = dasColourForName(style.COLOR2);
                        hic = dasColourForName(style.COLOR3);
                        frac = (relScore * 2.0) - 1.0;
                    }
                } else {
                    loc = dasColourForName(style.COLOR1);
                    hic = dasColourForName(style.COLOR2);
                    frac = relScore;
                }

                fill = new DColour(
                    ((loc.red * (1.0 - frac)) + (hic.red * frac))|0,
                    ((loc.green * (1.0 - frac)) + (hic.green * frac))|0,
                    ((loc.blue * (1.0 - frac)) + (hic.blue * frac))|0
                ).toSvgString();
            } 

            if (gtype == 'HISTOGRAM') {
                if (true) {
                    var relOrigin = (-1.0 * smin) / (smax - smin);
                    if (relScore >= relOrigin) {
                        height = Math.max(1, (relScore - relOrigin) * requiredHeight);
                        y = y + ((1.0 - relOrigin) * requiredHeight) - height;
                    } else {
                        height = Math.max(1, (relOrigin - relScore) * requiredHeight);
                        y = y + ((1.0 - relOrigin) * requiredHeight);
                    }
                } else {
                    // old impl
                    height = relScore * height;
                    y = y + (requiredHeight - height);
                }
                
                quant = {
                    min: smin,
                    max: smax
                };
            }

            minPos -= 0.25
            maxPos += 0.25;   // Fudge factor to mitigate pixel-jitter.
        }
 
        // dlog('min=' + min + '; max=' + max + '; minPos=' + minPos + '; maxPos=' + maxPos);

        var rect = document.createElementNS(NS_SVG, 'rect');
        rect.setAttribute('x', minPos);
        rect.setAttribute('y', y);
        rect.setAttribute('width', maxPos - minPos);
        rect.setAttribute('height', height);
        rect.setAttribute('stroke', stroke);
        rect.setAttribute('stroke-width', 1);
        rect.setAttribute('fill', fill);
        
        if (feature.visualWeight && feature.visualWeight < 1.0) {
            rect.setAttribute('fill-opacity', feature.visualWeight);
            if (stroke != 'none') {
                rect.setAttribute('stroke-opacity', feature.visualWeight);
            }
        }
        
        if (gtype == 'TOOMANY') {
            var bits = [rect];
            for (var i = 3; i < height; i += 3) {
                bits.push(makeElementNS(NS_SVG, 'line', null, {
                    x1: minPos,
                    y1: i,
                    x2: maxPos,
                    y2: i,
                    stroke: stroke,
                    strokeWidth: 0.5
                }));
            }
            glyph = makeElementNS(NS_SVG, 'g', bits);
        } else if (feature.seq && scale >= 1) {
            var refSeq;
            if (tier.currentSequence) {
                refSeq = tier.currentSequence;
            } else {
            }

            var seq  = feature.seq.toUpperCase();
            var gg = [];
            for (var i = 0; i < seq.length; ++i) {
                var base = seq.substr(i, 1);
                var color = null;
                // var color = baseColors[base];
                if (refSeq && refSeq.seq && refSeq.start <= min && refSeq.end >= max) {
                    var refBase = refSeq.seq.substr((min|0) + (i|0) - (refSeq.start|0), 1).toUpperCase();
                    if (refBase !== base) {
                        color = 'red';
                    }
                }

                if (!color) {
                    color = 'gray';
                }

                if (scale >= 8) {
                    var labelText = document.createElementNS(NS_SVG, 'text');
                    labelText.setAttribute("x", minPos + i*scale);
                    labelText.setAttribute("y",  12);
                    labelText.setAttribute('stroke', 'none');
                    labelText.setAttribute('fill', color);
                    labelText.appendChild(document.createTextNode(base));
                    gg.push(labelText);
                    requiredHeight = 14;
                } else {
                    var br = document.createElementNS(NS_SVG, 'rect');
                    br.setAttribute('x', minPos + i*scale);
                    br.setAttribute('y', y);
                    br.setAttribute('height', height);
                    br.setAttribute('width', scale);
                    br.setAttribute('fill', color);
                    br.setAttribute('stroke', 'none');
                    gg.push(br);
                }
            }

            if (scale >= 8) {
                min -= 1;
                max += 1;
            } else {
                min = Math.floor(min - (1 / scale))|0;
                max = Math.ceil(max + (1/scale))|0;
            }
            
            glyph = makeElementNS(NS_SVG, 'g', gg);
        } else {
            glyph = rect;
        }
    }

    if (glyph) {
        glyph.dalliance_feature = feature;
    }
    var dg = new DGlyph(glyph, min, max, requiredHeight);
    if (style.LABEL && (feature.label || feature.id)) {
        dg.label = feature.label || feature.id;
    }
    if (style.BUMP) {
        dg.bump = true;
    }
    dg.strand = feature.orientation || '0';
    if (quant) {
        dg.quant = quant;
    }
    dg.zindex = style.ZINDEX || 0;

    return dg;
}

function labelGlyph(tier, dglyph, featureTier) {
    var scale = tier.browser.scale, origin = tier.browser.origin;
    if (tier.dasSource.labels !== false) {
        if (dglyph.glyph && dglyph.label) {
            var label = dglyph.label;
            var labelText = document.createElementNS(NS_SVG, 'text');
            labelText.setAttribute('x', (dglyph.min - origin) * scale);
            labelText.setAttribute('y', dglyph.height + 15);
            labelText.setAttribute('stroke-width', 0);
            labelText.setAttribute('fill', 'black');
            labelText.setAttribute('class', 'label-text');
            labelText.setAttribute('font-family', 'helvetica');
            labelText.setAttribute('font-size', '10pt');
            //removed by jw
            //if (dglyph.strand == '+') {
                //label = label + '>';
            //} else if (dglyph.strand == '-') {
                //label = '<' + label;
            //}
            labelText.appendChild(document.createTextNode(label));

            featureTier.appendChild(labelText);
            var width = labelText.getBBox().width;
            featureTier.removeChild(labelText);

            var g;
            if (dglyph.glyph.localName == 'g') {
                g = dglyph.glyph;
            } else {
                g = document.createElementNS(NS_SVG, 'g');
                g.appendChild(dglyph.glyph);
            }
            g.appendChild(labelText);
            dglyph.glyph = g;
            dglyph.height = dglyph.height + 20;
            
            var textMax = (dglyph.min|0) + ((width + 10) / scale)
            if (textMax > dglyph.max) {
                var adj = (textMax - dglyph.max)/2;
                var nmin = ((dglyph.min - adj - origin) * scale) + 5;
                labelText.setAttribute('x', nmin)
                dglyph.min = ((nmin/scale)+origin)|0;
                dglyph.max = (textMax-adj)|0;
            } else {
                // Mark as a candidate for label-jiggling

                labelText.jiggleMin = (dglyph.min - origin) * scale;
                labelText.jiggleMax = ((dglyph.max - origin) * scale) - width;
            }
        }
    }
    return dglyph;
}/*! jQuery v1.7.2 jquery.com | jquery.org/license */
(function(a,b){function cy(a){return f.isWindow(a)?a:a.nodeType===9?a.defaultView||a.parentWindow:!1}function cu(a){if(!cj[a]){var b=c.body,d=f("<"+a+">").appendTo(b),e=d.css("display");d.remove();if(e==="none"||e===""){ck||(ck=c.createElement("iframe"),ck.frameBorder=ck.width=ck.height=0),b.appendChild(ck);if(!cl||!ck.createElement)cl=(ck.contentWindow||ck.contentDocument).document,cl.write((f.support.boxModel?"<!doctype html>":"")+"<html><body>"),cl.close();d=cl.createElement(a),cl.body.appendChild(d),e=f.css(d,"display"),b.removeChild(ck)}cj[a]=e}return cj[a]}function ct(a,b){var c={};f.each(cp.concat.apply([],cp.slice(0,b)),function(){c[this]=a});return c}function cs(){cq=b}function cr(){setTimeout(cs,0);return cq=f.now()}function ci(){try{return new a.ActiveXObject("Microsoft.XMLHTTP")}catch(b){}}function ch(){try{return new a.XMLHttpRequest}catch(b){}}function cb(a,c){a.dataFilter&&(c=a.dataFilter(c,a.dataType));var d=a.dataTypes,e={},g,h,i=d.length,j,k=d[0],l,m,n,o,p;for(g=1;g<i;g++){if(g===1)for(h in a.converters)typeof h=="string"&&(e[h.toLowerCase()]=a.converters[h]);l=k,k=d[g];if(k==="*")k=l;else if(l!=="*"&&l!==k){m=l+" "+k,n=e[m]||e["* "+k];if(!n){p=b;for(o in e){j=o.split(" ");if(j[0]===l||j[0]==="*"){p=e[j[1]+" "+k];if(p){o=e[o],o===!0?n=p:p===!0&&(n=o);break}}}}!n&&!p&&f.error("No conversion from "+m.replace(" "," to ")),n!==!0&&(c=n?n(c):p(o(c)))}}return c}function ca(a,c,d){var e=a.contents,f=a.dataTypes,g=a.responseFields,h,i,j,k;for(i in g)i in d&&(c[g[i]]=d[i]);while(f[0]==="*")f.shift(),h===b&&(h=a.mimeType||c.getResponseHeader("content-type"));if(h)for(i in e)if(e[i]&&e[i].test(h)){f.unshift(i);break}if(f[0]in d)j=f[0];else{for(i in d){if(!f[0]||a.converters[i+" "+f[0]]){j=i;break}k||(k=i)}j=j||k}if(j){j!==f[0]&&f.unshift(j);return d[j]}}function b_(a,b,c,d){if(f.isArray(b))f.each(b,function(b,e){c||bD.test(a)?d(a,e):b_(a+"["+(typeof e=="object"?b:"")+"]",e,c,d)});else if(!c&&f.type(b)==="object")for(var e in b)b_(a+"["+e+"]",b[e],c,d);else d(a,b)}function b$(a,c){var d,e,g=f.ajaxSettings.flatOptions||{};for(d in c)c[d]!==b&&((g[d]?a:e||(e={}))[d]=c[d]);e&&f.extend(!0,a,e)}function bZ(a,c,d,e,f,g){f=f||c.dataTypes[0],g=g||{},g[f]=!0;var h=a[f],i=0,j=h?h.length:0,k=a===bS,l;for(;i<j&&(k||!l);i++)l=h[i](c,d,e),typeof l=="string"&&(!k||g[l]?l=b:(c.dataTypes.unshift(l),l=bZ(a,c,d,e,l,g)));(k||!l)&&!g["*"]&&(l=bZ(a,c,d,e,"*",g));return l}function bY(a){return function(b,c){typeof b!="string"&&(c=b,b="*");if(f.isFunction(c)){var d=b.toLowerCase().split(bO),e=0,g=d.length,h,i,j;for(;e<g;e++)h=d[e],j=/^\+/.test(h),j&&(h=h.substr(1)||"*"),i=a[h]=a[h]||[],i[j?"unshift":"push"](c)}}}function bB(a,b,c){var d=b==="width"?a.offsetWidth:a.offsetHeight,e=b==="width"?1:0,g=4;if(d>0){if(c!=="border")for(;e<g;e+=2)c||(d-=parseFloat(f.css(a,"padding"+bx[e]))||0),c==="margin"?d+=parseFloat(f.css(a,c+bx[e]))||0:d-=parseFloat(f.css(a,"border"+bx[e]+"Width"))||0;return d+"px"}d=by(a,b);if(d<0||d==null)d=a.style[b];if(bt.test(d))return d;d=parseFloat(d)||0;if(c)for(;e<g;e+=2)d+=parseFloat(f.css(a,"padding"+bx[e]))||0,c!=="padding"&&(d+=parseFloat(f.css(a,"border"+bx[e]+"Width"))||0),c==="margin"&&(d+=parseFloat(f.css(a,c+bx[e]))||0);return d+"px"}function bo(a){var b=c.createElement("div");bh.appendChild(b),b.innerHTML=a.outerHTML;return b.firstChild}function bn(a){var b=(a.nodeName||"").toLowerCase();b==="input"?bm(a):b!=="script"&&typeof a.getElementsByTagName!="undefined"&&f.grep(a.getElementsByTagName("input"),bm)}function bm(a){if(a.type==="checkbox"||a.type==="radio")a.defaultChecked=a.checked}function bl(a){return typeof a.getElementsByTagName!="undefined"?a.getElementsByTagName("*"):typeof a.querySelectorAll!="undefined"?a.querySelectorAll("*"):[]}function bk(a,b){var c;b.nodeType===1&&(b.clearAttributes&&b.clearAttributes(),b.mergeAttributes&&b.mergeAttributes(a),c=b.nodeName.toLowerCase(),c==="object"?b.outerHTML=a.outerHTML:c!=="input"||a.type!=="checkbox"&&a.type!=="radio"?c==="option"?b.selected=a.defaultSelected:c==="input"||c==="textarea"?b.defaultValue=a.defaultValue:c==="script"&&b.text!==a.text&&(b.text=a.text):(a.checked&&(b.defaultChecked=b.checked=a.checked),b.value!==a.value&&(b.value=a.value)),b.removeAttribute(f.expando),b.removeAttribute("_submit_attached"),b.removeAttribute("_change_attached"))}function bj(a,b){if(b.nodeType===1&&!!f.hasData(a)){var c,d,e,g=f._data(a),h=f._data(b,g),i=g.events;if(i){delete h.handle,h.events={};for(c in i)for(d=0,e=i[c].length;d<e;d++)f.event.add(b,c,i[c][d])}h.data&&(h.data=f.extend({},h.data))}}function bi(a,b){return f.nodeName(a,"table")?a.getElementsByTagName("tbody")[0]||a.appendChild(a.ownerDocument.createElement("tbody")):a}function U(a){var b=V.split("|"),c=a.createDocumentFragment();if(c.createElement)while(b.length)c.createElement(b.pop());return c}function T(a,b,c){b=b||0;if(f.isFunction(b))return f.grep(a,function(a,d){var e=!!b.call(a,d,a);return e===c});if(b.nodeType)return f.grep(a,function(a,d){return a===b===c});if(typeof b=="string"){var d=f.grep(a,function(a){return a.nodeType===1});if(O.test(b))return f.filter(b,d,!c);b=f.filter(b,d)}return f.grep(a,function(a,d){return f.inArray(a,b)>=0===c})}function S(a){return!a||!a.parentNode||a.parentNode.nodeType===11}function K(){return!0}function J(){return!1}function n(a,b,c){var d=b+"defer",e=b+"queue",g=b+"mark",h=f._data(a,d);h&&(c==="queue"||!f._data(a,e))&&(c==="mark"||!f._data(a,g))&&setTimeout(function(){!f._data(a,e)&&!f._data(a,g)&&(f.removeData(a,d,!0),h.fire())},0)}function m(a){for(var b in a){if(b==="data"&&f.isEmptyObject(a[b]))continue;if(b!=="toJSON")return!1}return!0}function l(a,c,d){if(d===b&&a.nodeType===1){var e="data-"+c.replace(k,"-$1").toLowerCase();d=a.getAttribute(e);if(typeof d=="string"){try{d=d==="true"?!0:d==="false"?!1:d==="null"?null:f.isNumeric(d)?+d:j.test(d)?f.parseJSON(d):d}catch(g){}f.data(a,c,d)}else d=b}return d}function h(a){var b=g[a]={},c,d;a=a.split(/\s+/);for(c=0,d=a.length;c<d;c++)b[a[c]]=!0;return b}var c=a.document,d=a.navigator,e=a.location,f=function(){function J(){if(!e.isReady){try{c.documentElement.doScroll("left")}catch(a){setTimeout(J,1);return}e.ready()}}var e=function(a,b){return new e.fn.init(a,b,h)},f=a.jQuery,g=a.$,h,i=/^(?:[^#<]*(<[\w\W]+>)[^>]*$|#([\w\-]*)$)/,j=/\S/,k=/^\s+/,l=/\s+$/,m=/^<(\w+)\s*\/?>(?:<\/\1>)?$/,n=/^[\],:{}\s]*$/,o=/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,p=/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,q=/(?:^|:|,)(?:\s*\[)+/g,r=/(webkit)[ \/]([\w.]+)/,s=/(opera)(?:.*version)?[ \/]([\w.]+)/,t=/(msie) ([\w.]+)/,u=/(mozilla)(?:.*? rv:([\w.]+))?/,v=/-([a-z]|[0-9])/ig,w=/^-ms-/,x=function(a,b){return(b+"").toUpperCase()},y=d.userAgent,z,A,B,C=Object.prototype.toString,D=Object.prototype.hasOwnProperty,E=Array.prototype.push,F=Array.prototype.slice,G=String.prototype.trim,H=Array.prototype.indexOf,I={};e.fn=e.prototype={constructor:e,init:function(a,d,f){var g,h,j,k;if(!a)return this;if(a.nodeType){this.context=this[0]=a,this.length=1;return this}if(a==="body"&&!d&&c.body){this.context=c,this[0]=c.body,this.selector=a,this.length=1;return this}if(typeof a=="string"){a.charAt(0)!=="<"||a.charAt(a.length-1)!==">"||a.length<3?g=i.exec(a):g=[null,a,null];if(g&&(g[1]||!d)){if(g[1]){d=d instanceof e?d[0]:d,k=d?d.ownerDocument||d:c,j=m.exec(a),j?e.isPlainObject(d)?(a=[c.createElement(j[1])],e.fn.attr.call(a,d,!0)):a=[k.createElement(j[1])]:(j=e.buildFragment([g[1]],[k]),a=(j.cacheable?e.clone(j.fragment):j.fragment).childNodes);return e.merge(this,a)}h=c.getElementById(g[2]);if(h&&h.parentNode){if(h.id!==g[2])return f.find(a);this.length=1,this[0]=h}this.context=c,this.selector=a;return this}return!d||d.jquery?(d||f).find(a):this.constructor(d).find(a)}if(e.isFunction(a))return f.ready(a);a.selector!==b&&(this.selector=a.selector,this.context=a.context);return e.makeArray(a,this)},selector:"",jquery:"1.7.2",length:0,size:function(){return this.length},toArray:function(){return F.call(this,0)},get:function(a){return a==null?this.toArray():a<0?this[this.length+a]:this[a]},pushStack:function(a,b,c){var d=this.constructor();e.isArray(a)?E.apply(d,a):e.merge(d,a),d.prevObject=this,d.context=this.context,b==="find"?d.selector=this.selector+(this.selector?" ":"")+c:b&&(d.selector=this.selector+"."+b+"("+c+")");return d},each:function(a,b){return e.each(this,a,b)},ready:function(a){e.bindReady(),A.add(a);return this},eq:function(a){a=+a;return a===-1?this.slice(a):this.slice(a,a+1)},first:function(){return this.eq(0)},last:function(){return this.eq(-1)},slice:function(){return this.pushStack(F.apply(this,arguments),"slice",F.call(arguments).join(","))},map:function(a){return this.pushStack(e.map(this,function(b,c){return a.call(b,c,b)}))},end:function(){return this.prevObject||this.constructor(null)},push:E,sort:[].sort,splice:[].splice},e.fn.init.prototype=e.fn,e.extend=e.fn.extend=function(){var a,c,d,f,g,h,i=arguments[0]||{},j=1,k=arguments.length,l=!1;typeof i=="boolean"&&(l=i,i=arguments[1]||{},j=2),typeof i!="object"&&!e.isFunction(i)&&(i={}),k===j&&(i=this,--j);for(;j<k;j++)if((a=arguments[j])!=null)for(c in a){d=i[c],f=a[c];if(i===f)continue;l&&f&&(e.isPlainObject(f)||(g=e.isArray(f)))?(g?(g=!1,h=d&&e.isArray(d)?d:[]):h=d&&e.isPlainObject(d)?d:{},i[c]=e.extend(l,h,f)):f!==b&&(i[c]=f)}return i},e.extend({noConflict:function(b){a.$===e&&(a.$=g),b&&a.jQuery===e&&(a.jQuery=f);return e},isReady:!1,readyWait:1,holdReady:function(a){a?e.readyWait++:e.ready(!0)},ready:function(a){if(a===!0&&!--e.readyWait||a!==!0&&!e.isReady){if(!c.body)return setTimeout(e.ready,1);e.isReady=!0;if(a!==!0&&--e.readyWait>0)return;A.fireWith(c,[e]),e.fn.trigger&&e(c).trigger("ready").off("ready")}},bindReady:function(){if(!A){A=e.Callbacks("once memory");if(c.readyState==="complete")return setTimeout(e.ready,1);if(c.addEventListener)c.addEventListener("DOMContentLoaded",B,!1),a.addEventListener("load",e.ready,!1);else if(c.attachEvent){c.attachEvent("onreadystatechange",B),a.attachEvent("onload",e.ready);var b=!1;try{b=a.frameElement==null}catch(d){}c.documentElement.doScroll&&b&&J()}}},isFunction:function(a){return e.type(a)==="function"},isArray:Array.isArray||function(a){return e.type(a)==="array"},isWindow:function(a){return a!=null&&a==a.window},isNumeric:function(a){return!isNaN(parseFloat(a))&&isFinite(a)},type:function(a){return a==null?String(a):I[C.call(a)]||"object"},isPlainObject:function(a){if(!a||e.type(a)!=="object"||a.nodeType||e.isWindow(a))return!1;try{if(a.constructor&&!D.call(a,"constructor")&&!D.call(a.constructor.prototype,"isPrototypeOf"))return!1}catch(c){return!1}var d;for(d in a);return d===b||D.call(a,d)},isEmptyObject:function(a){for(var b in a)return!1;return!0},error:function(a){throw new Error(a)},parseJSON:function(b){if(typeof b!="string"||!b)return null;b=e.trim(b);if(a.JSON&&a.JSON.parse)return a.JSON.parse(b);if(n.test(b.replace(o,"@").replace(p,"]").replace(q,"")))return(new Function("return "+b))();e.error("Invalid JSON: "+b)},parseXML:function(c){if(typeof c!="string"||!c)return null;var d,f;try{a.DOMParser?(f=new DOMParser,d=f.parseFromString(c,"text/xml")):(d=new ActiveXObject("Microsoft.XMLDOM"),d.async="false",d.loadXML(c))}catch(g){d=b}(!d||!d.documentElement||d.getElementsByTagName("parsererror").length)&&e.error("Invalid XML: "+c);return d},noop:function(){},globalEval:function(b){b&&j.test(b)&&(a.execScript||function(b){a.eval.call(a,b)})(b)},camelCase:function(a){return a.replace(w,"ms-").replace(v,x)},nodeName:function(a,b){return a.nodeName&&a.nodeName.toUpperCase()===b.toUpperCase()},each:function(a,c,d){var f,g=0,h=a.length,i=h===b||e.isFunction(a);if(d){if(i){for(f in a)if(c.apply(a[f],d)===!1)break}else for(;g<h;)if(c.apply(a[g++],d)===!1)break}else if(i){for(f in a)if(c.call(a[f],f,a[f])===!1)break}else for(;g<h;)if(c.call(a[g],g,a[g++])===!1)break;return a},trim:G?function(a){return a==null?"":G.call(a)}:function(a){return a==null?"":(a+"").replace(k,"").replace(l,"")},makeArray:function(a,b){var c=b||[];if(a!=null){var d=e.type(a);a.length==null||d==="string"||d==="function"||d==="regexp"||e.isWindow(a)?E.call(c,a):e.merge(c,a)}return c},inArray:function(a,b,c){var d;if(b){if(H)return H.call(b,a,c);d=b.length,c=c?c<0?Math.max(0,d+c):c:0;for(;c<d;c++)if(c in b&&b[c]===a)return c}return-1},merge:function(a,c){var d=a.length,e=0;if(typeof c.length=="number")for(var f=c.length;e<f;e++)a[d++]=c[e];else while(c[e]!==b)a[d++]=c[e++];a.length=d;return a},grep:function(a,b,c){var d=[],e;c=!!c;for(var f=0,g=a.length;f<g;f++)e=!!b(a[f],f),c!==e&&d.push(a[f]);return d},map:function(a,c,d){var f,g,h=[],i=0,j=a.length,k=a instanceof e||j!==b&&typeof j=="number"&&(j>0&&a[0]&&a[j-1]||j===0||e.isArray(a));if(k)for(;i<j;i++)f=c(a[i],i,d),f!=null&&(h[h.length]=f);else for(g in a)f=c(a[g],g,d),f!=null&&(h[h.length]=f);return h.concat.apply([],h)},guid:1,proxy:function(a,c){if(typeof c=="string"){var d=a[c];c=a,a=d}if(!e.isFunction(a))return b;var f=F.call(arguments,2),g=function(){return a.apply(c,f.concat(F.call(arguments)))};g.guid=a.guid=a.guid||g.guid||e.guid++;return g},access:function(a,c,d,f,g,h,i){var j,k=d==null,l=0,m=a.length;if(d&&typeof d=="object"){for(l in d)e.access(a,c,l,d[l],1,h,f);g=1}else if(f!==b){j=i===b&&e.isFunction(f),k&&(j?(j=c,c=function(a,b,c){return j.call(e(a),c)}):(c.call(a,f),c=null));if(c)for(;l<m;l++)c(a[l],d,j?f.call(a[l],l,c(a[l],d)):f,i);g=1}return g?a:k?c.call(a):m?c(a[0],d):h},now:function(){return(new Date).getTime()},uaMatch:function(a){a=a.toLowerCase();var b=r.exec(a)||s.exec(a)||t.exec(a)||a.indexOf("compatible")<0&&u.exec(a)||[];return{browser:b[1]||"",version:b[2]||"0"}},sub:function(){function a(b,c){return new a.fn.init(b,c)}e.extend(!0,a,this),a.superclass=this,a.fn=a.prototype=this(),a.fn.constructor=a,a.sub=this.sub,a.fn.init=function(d,f){f&&f instanceof e&&!(f instanceof a)&&(f=a(f));return e.fn.init.call(this,d,f,b)},a.fn.init.prototype=a.fn;var b=a(c);return a},browser:{}}),e.each("Boolean Number String Function Array Date RegExp Object".split(" "),function(a,b){I["[object "+b+"]"]=b.toLowerCase()}),z=e.uaMatch(y),z.browser&&(e.browser[z.browser]=!0,e.browser.version=z.version),e.browser.webkit&&(e.browser.safari=!0),j.test(" ")&&(k=/^[\s\xA0]+/,l=/[\s\xA0]+$/),h=e(c),c.addEventListener?B=function(){c.removeEventListener("DOMContentLoaded",B,!1),e.ready()}:c.attachEvent&&(B=function(){c.readyState==="complete"&&(c.detachEvent("onreadystatechange",B),e.ready())});return e}(),g={};f.Callbacks=function(a){a=a?g[a]||h(a):{};var c=[],d=[],e,i,j,k,l,m,n=function(b){var d,e,g,h,i;for(d=0,e=b.length;d<e;d++)g=b[d],h=f.type(g),h==="array"?n(g):h==="function"&&(!a.unique||!p.has(g))&&c.push(g)},o=function(b,f){f=f||[],e=!a.memory||[b,f],i=!0,j=!0,m=k||0,k=0,l=c.length;for(;c&&m<l;m++)if(c[m].apply(b,f)===!1&&a.stopOnFalse){e=!0;break}j=!1,c&&(a.once?e===!0?p.disable():c=[]:d&&d.length&&(e=d.shift(),p.fireWith(e[0],e[1])))},p={add:function(){if(c){var a=c.length;n(arguments),j?l=c.length:e&&e!==!0&&(k=a,o(e[0],e[1]))}return this},remove:function(){if(c){var b=arguments,d=0,e=b.length;for(;d<e;d++)for(var f=0;f<c.length;f++)if(b[d]===c[f]){j&&f<=l&&(l--,f<=m&&m--),c.splice(f--,1);if(a.unique)break}}return this},has:function(a){if(c){var b=0,d=c.length;for(;b<d;b++)if(a===c[b])return!0}return!1},empty:function(){c=[];return this},disable:function(){c=d=e=b;return this},disabled:function(){return!c},lock:function(){d=b,(!e||e===!0)&&p.disable();return this},locked:function(){return!d},fireWith:function(b,c){d&&(j?a.once||d.push([b,c]):(!a.once||!e)&&o(b,c));return this},fire:function(){p.fireWith(this,arguments);return this},fired:function(){return!!i}};return p};var i=[].slice;f.extend({Deferred:function(a){var b=f.Callbacks("once memory"),c=f.Callbacks("once memory"),d=f.Callbacks("memory"),e="pending",g={resolve:b,reject:c,notify:d},h={done:b.add,fail:c.add,progress:d.add,state:function(){return e},isResolved:b.fired,isRejected:c.fired,then:function(a,b,c){i.done(a).fail(b).progress(c);return this},always:function(){i.done.apply(i,arguments).fail.apply(i,arguments);return this},pipe:function(a,b,c){return f.Deferred(function(d){f.each({done:[a,"resolve"],fail:[b,"reject"],progress:[c,"notify"]},function(a,b){var c=b[0],e=b[1],g;f.isFunction(c)?i[a](function(){g=c.apply(this,arguments),g&&f.isFunction(g.promise)?g.promise().then(d.resolve,d.reject,d.notify):d[e+"With"](this===i?d:this,[g])}):i[a](d[e])})}).promise()},promise:function(a){if(a==null)a=h;else for(var b in h)a[b]=h[b];return a}},i=h.promise({}),j;for(j in g)i[j]=g[j].fire,i[j+"With"]=g[j].fireWith;i.done(function(){e="resolved"},c.disable,d.lock).fail(function(){e="rejected"},b.disable,d.lock),a&&a.call(i,i);return i},when:function(a){function m(a){return function(b){e[a]=arguments.length>1?i.call(arguments,0):b,j.notifyWith(k,e)}}function l(a){return function(c){b[a]=arguments.length>1?i.call(arguments,0):c,--g||j.resolveWith(j,b)}}var b=i.call(arguments,0),c=0,d=b.length,e=Array(d),g=d,h=d,j=d<=1&&a&&f.isFunction(a.promise)?a:f.Deferred(),k=j.promise();if(d>1){for(;c<d;c++)b[c]&&b[c].promise&&f.isFunction(b[c].promise)?b[c].promise().then(l(c),j.reject,m(c)):--g;g||j.resolveWith(j,b)}else j!==a&&j.resolveWith(j,d?[a]:[]);return k}}),f.support=function(){var b,d,e,g,h,i,j,k,l,m,n,o,p=c.createElement("div"),q=c.documentElement;p.setAttribute("className","t"),p.innerHTML="   <link/><table></table><a href='/a' style='top:1px;float:left;opacity:.55;'>a</a><input type='checkbox'/>",d=p.getElementsByTagName("*"),e=p.getElementsByTagName("a")[0];if(!d||!d.length||!e)return{};g=c.createElement("select"),h=g.appendChild(c.createElement("option")),i=p.getElementsByTagName("input")[0],b={leadingWhitespace:p.firstChild.nodeType===3,tbody:!p.getElementsByTagName("tbody").length,htmlSerialize:!!p.getElementsByTagName("link").length,style:/top/.test(e.getAttribute("style")),hrefNormalized:e.getAttribute("href")==="/a",opacity:/^0.55/.test(e.style.opacity),cssFloat:!!e.style.cssFloat,checkOn:i.value==="on",optSelected:h.selected,getSetAttribute:p.className!=="t",enctype:!!c.createElement("form").enctype,html5Clone:c.createElement("nav").cloneNode(!0).outerHTML!=="<:nav></:nav>",submitBubbles:!0,changeBubbles:!0,focusinBubbles:!1,deleteExpando:!0,noCloneEvent:!0,inlineBlockNeedsLayout:!1,shrinkWrapBlocks:!1,reliableMarginRight:!0,pixelMargin:!0},f.boxModel=b.boxModel=c.compatMode==="CSS1Compat",i.checked=!0,b.noCloneChecked=i.cloneNode(!0).checked,g.disabled=!0,b.optDisabled=!h.disabled;try{delete p.test}catch(r){b.deleteExpando=!1}!p.addEventListener&&p.attachEvent&&p.fireEvent&&(p.attachEvent("onclick",function(){b.noCloneEvent=!1}),p.cloneNode(!0).fireEvent("onclick")),i=c.createElement("input"),i.value="t",i.setAttribute("type","radio"),b.radioValue=i.value==="t",i.setAttribute("checked","checked"),i.setAttribute("name","t"),p.appendChild(i),j=c.createDocumentFragment(),j.appendChild(p.lastChild),b.checkClone=j.cloneNode(!0).cloneNode(!0).lastChild.checked,b.appendChecked=i.checked,j.removeChild(i),j.appendChild(p);if(p.attachEvent)for(n in{submit:1,change:1,focusin:1})m="on"+n,o=m in p,o||(p.setAttribute(m,"return;"),o=typeof p[m]=="function"),b[n+"Bubbles"]=o;j.removeChild(p),j=g=h=p=i=null,f(function(){var d,e,g,h,i,j,l,m,n,q,r,s,t,u=c.getElementsByTagName("body")[0];!u||(m=1,t="padding:0;margin:0;border:",r="position:absolute;top:0;left:0;width:1px;height:1px;",s=t+"0;visibility:hidden;",n="style='"+r+t+"5px solid #000;",q="<div "+n+"display:block;'><div style='"+t+"0;display:block;overflow:hidden;'></div></div>"+"<table "+n+"' cellpadding='0' cellspacing='0'>"+"<tr><td></td></tr></table>",d=c.createElement("div"),d.style.cssText=s+"width:0;height:0;position:static;top:0;margin-top:"+m+"px",u.insertBefore(d,u.firstChild),p=c.createElement("div"),d.appendChild(p),p.innerHTML="<table><tr><td style='"+t+"0;display:none'></td><td>t</td></tr></table>",k=p.getElementsByTagName("td"),o=k[0].offsetHeight===0,k[0].style.display="",k[1].style.display="none",b.reliableHiddenOffsets=o&&k[0].offsetHeight===0,a.getComputedStyle&&(p.innerHTML="",l=c.createElement("div"),l.style.width="0",l.style.marginRight="0",p.style.width="2px",p.appendChild(l),b.reliableMarginRight=(parseInt((a.getComputedStyle(l,null)||{marginRight:0}).marginRight,10)||0)===0),typeof p.style.zoom!="undefined"&&(p.innerHTML="",p.style.width=p.style.padding="1px",p.style.border=0,p.style.overflow="hidden",p.style.display="inline",p.style.zoom=1,b.inlineBlockNeedsLayout=p.offsetWidth===3,p.style.display="block",p.style.overflow="visible",p.innerHTML="<div style='width:5px;'></div>",b.shrinkWrapBlocks=p.offsetWidth!==3),p.style.cssText=r+s,p.innerHTML=q,e=p.firstChild,g=e.firstChild,i=e.nextSibling.firstChild.firstChild,j={doesNotAddBorder:g.offsetTop!==5,doesAddBorderForTableAndCells:i.offsetTop===5},g.style.position="fixed",g.style.top="20px",j.fixedPosition=g.offsetTop===20||g.offsetTop===15,g.style.position=g.style.top="",e.style.overflow="hidden",e.style.position="relative",j.subtractsBorderForOverflowNotVisible=g.offsetTop===-5,j.doesNotIncludeMarginInBodyOffset=u.offsetTop!==m,a.getComputedStyle&&(p.style.marginTop="1%",b.pixelMargin=(a.getComputedStyle(p,null)||{marginTop:0}).marginTop!=="1%"),typeof d.style.zoom!="undefined"&&(d.style.zoom=1),u.removeChild(d),l=p=d=null,f.extend(b,j))});return b}();var j=/^(?:\{.*\}|\[.*\])$/,k=/([A-Z])/g;f.extend({cache:{},uuid:0,expando:"jQuery"+(f.fn.jquery+Math.random()).replace(/\D/g,""),noData:{embed:!0,object:"clsid:D27CDB6E-AE6D-11cf-96B8-444553540000",applet:!0},hasData:function(a){a=a.nodeType?f.cache[a[f.expando]]:a[f.expando];return!!a&&!m(a)},data:function(a,c,d,e){if(!!f.acceptData(a)){var g,h,i,j=f.expando,k=typeof c=="string",l=a.nodeType,m=l?f.cache:a,n=l?a[j]:a[j]&&j,o=c==="events";if((!n||!m[n]||!o&&!e&&!m[n].data)&&k&&d===b)return;n||(l?a[j]=n=++f.uuid:n=j),m[n]||(m[n]={},l||(m[n].toJSON=f.noop));if(typeof c=="object"||typeof c=="function")e?m[n]=f.extend(m[n],c):m[n].data=f.extend(m[n].data,c);g=h=m[n],e||(h.data||(h.data={}),h=h.data),d!==b&&(h[f.camelCase(c)]=d);if(o&&!h[c])return g.events;k?(i=h[c],i==null&&(i=h[f.camelCase(c)])):i=h;return i}},removeData:function(a,b,c){if(!!f.acceptData(a)){var d,e,g,h=f.expando,i=a.nodeType,j=i?f.cache:a,k=i?a[h]:h;if(!j[k])return;if(b){d=c?j[k]:j[k].data;if(d){f.isArray(b)||(b in d?b=[b]:(b=f.camelCase(b),b in d?b=[b]:b=b.split(" ")));for(e=0,g=b.length;e<g;e++)delete d[b[e]];if(!(c?m:f.isEmptyObject)(d))return}}if(!c){delete j[k].data;if(!m(j[k]))return}f.support.deleteExpando||!j.setInterval?delete j[k]:j[k]=null,i&&(f.support.deleteExpando?delete a[h]:a.removeAttribute?a.removeAttribute(h):a[h]=null)}},_data:function(a,b,c){return f.data(a,b,c,!0)},acceptData:function(a){if(a.nodeName){var b=f.noData[a.nodeName.toLowerCase()];if(b)return b!==!0&&a.getAttribute("classid")===b}return!0}}),f.fn.extend({data:function(a,c){var d,e,g,h,i,j=this[0],k=0,m=null;if(a===b){if(this.length){m=f.data(j);if(j.nodeType===1&&!f._data(j,"parsedAttrs")){g=j.attributes;for(i=g.length;k<i;k++)h=g[k].name,h.indexOf("data-")===0&&(h=f.camelCase(h.substring(5)),l(j,h,m[h]));f._data(j,"parsedAttrs",!0)}}return m}if(typeof a=="object")return this.each(function(){f.data(this,a)});d=a.split(".",2),d[1]=d[1]?"."+d[1]:"",e=d[1]+"!";return f.access(this,function(c){if(c===b){m=this.triggerHandler("getData"+e,[d[0]]),m===b&&j&&(m=f.data(j,a),m=l(j,a,m));return m===b&&d[1]?this.data(d[0]):m}d[1]=c,this.each(function(){var b=f(this);b.triggerHandler("setData"+e,d),f.data(this,a,c),b.triggerHandler("changeData"+e,d)})},null,c,arguments.length>1,null,!1)},removeData:function(a){return this.each(function(){f.removeData(this,a)})}}),f.extend({_mark:function(a,b){a&&(b=(b||"fx")+"mark",f._data(a,b,(f._data(a,b)||0)+1))},_unmark:function(a,b,c){a!==!0&&(c=b,b=a,a=!1);if(b){c=c||"fx";var d=c+"mark",e=a?0:(f._data(b,d)||1)-1;e?f._data(b,d,e):(f.removeData(b,d,!0),n(b,c,"mark"))}},queue:function(a,b,c){var d;if(a){b=(b||"fx")+"queue",d=f._data(a,b),c&&(!d||f.isArray(c)?d=f._data(a,b,f.makeArray(c)):d.push(c));return d||[]}},dequeue:function(a,b){b=b||"fx";var c=f.queue(a,b),d=c.shift(),e={};d==="inprogress"&&(d=c.shift()),d&&(b==="fx"&&c.unshift("inprogress"),f._data(a,b+".run",e),d.call(a,function(){f.dequeue(a,b)},e)),c.length||(f.removeData(a,b+"queue "+b+".run",!0),n(a,b,"queue"))}}),f.fn.extend({queue:function(a,c){var d=2;typeof a!="string"&&(c=a,a="fx",d--);if(arguments.length<d)return f.queue(this[0],a);return c===b?this:this.each(function(){var b=f.queue(this,a,c);a==="fx"&&b[0]!=="inprogress"&&f.dequeue(this,a)})},dequeue:function(a){return this.each(function(){f.dequeue(this,a)})},delay:function(a,b){a=f.fx?f.fx.speeds[a]||a:a,b=b||"fx";return this.queue(b,function(b,c){var d=setTimeout(b,a);c.stop=function(){clearTimeout(d)}})},clearQueue:function(a){return this.queue(a||"fx",[])},promise:function(a,c){function m(){--h||d.resolveWith(e,[e])}typeof a!="string"&&(c=a,a=b),a=a||"fx";var d=f.Deferred(),e=this,g=e.length,h=1,i=a+"defer",j=a+"queue",k=a+"mark",l;while(g--)if(l=f.data(e[g],i,b,!0)||(f.data(e[g],j,b,!0)||f.data(e[g],k,b,!0))&&f.data(e[g],i,f.Callbacks("once memory"),!0))h++,l.add(m);m();return d.promise(c)}});var o=/[\n\t\r]/g,p=/\s+/,q=/\r/g,r=/^(?:button|input)$/i,s=/^(?:button|input|object|select|textarea)$/i,t=/^a(?:rea)?$/i,u=/^(?:autofocus|autoplay|async|checked|controls|defer|disabled|hidden|loop|multiple|open|readonly|required|scoped|selected)$/i,v=f.support.getSetAttribute,w,x,y;f.fn.extend({attr:function(a,b){return f.access(this,f.attr,a,b,arguments.length>1)},removeAttr:function(a){return this.each(function(){f.removeAttr(this,a)})},prop:function(a,b){return f.access(this,f.prop,a,b,arguments.length>1)},removeProp:function(a){a=f.propFix[a]||a;return this.each(function(){try{this[a]=b,delete this[a]}catch(c){}})},addClass:function(a){var b,c,d,e,g,h,i;if(f.isFunction(a))return this.each(function(b){f(this).addClass(a.call(this,b,this.className))});if(a&&typeof a=="string"){b=a.split(p);for(c=0,d=this.length;c<d;c++){e=this[c];if(e.nodeType===1)if(!e.className&&b.length===1)e.className=a;else{g=" "+e.className+" ";for(h=0,i=b.length;h<i;h++)~g.indexOf(" "+b[h]+" ")||(g+=b[h]+" ");e.className=f.trim(g)}}}return this},removeClass:function(a){var c,d,e,g,h,i,j;if(f.isFunction(a))return this.each(function(b){f(this).removeClass(a.call(this,b,this.className))});if(a&&typeof a=="string"||a===b){c=(a||"").split(p);for(d=0,e=this.length;d<e;d++){g=this[d];if(g.nodeType===1&&g.className)if(a){h=(" "+g.className+" ").replace(o," ");for(i=0,j=c.length;i<j;i++)h=h.replace(" "+c[i]+" "," ");g.className=f.trim(h)}else g.className=""}}return this},toggleClass:function(a,b){var c=typeof a,d=typeof b=="boolean";if(f.isFunction(a))return this.each(function(c){f(this).toggleClass(a.call(this,c,this.className,b),b)});return this.each(function(){if(c==="string"){var e,g=0,h=f(this),i=b,j=a.split(p);while(e=j[g++])i=d?i:!h.hasClass(e),h[i?"addClass":"removeClass"](e)}else if(c==="undefined"||c==="boolean")this.className&&f._data(this,"__className__",this.className),this.className=this.className||a===!1?"":f._data(this,"__className__")||""})},hasClass:function(a){var b=" "+a+" ",c=0,d=this.length;for(;c<d;c++)if(this[c].nodeType===1&&(" "+this[c].className+" ").replace(o," ").indexOf(b)>-1)return!0;return!1},val:function(a){var c,d,e,g=this[0];{if(!!arguments.length){e=f.isFunction(a);return this.each(function(d){var g=f(this),h;if(this.nodeType===1){e?h=a.call(this,d,g.val()):h=a,h==null?h="":typeof h=="number"?h+="":f.isArray(h)&&(h=f.map(h,function(a){return a==null?"":a+""})),c=f.valHooks[this.type]||f.valHooks[this.nodeName.toLowerCase()];if(!c||!("set"in c)||c.set(this,h,"value")===b)this.value=h}})}if(g){c=f.valHooks[g.type]||f.valHooks[g.nodeName.toLowerCase()];if(c&&"get"in c&&(d=c.get(g,"value"))!==b)return d;d=g.value;return typeof d=="string"?d.replace(q,""):d==null?"":d}}}}),f.extend({valHooks:{option:{get:function(a){var b=a.attributes.value;return!b||b.specified?a.value:a.text}},select:{get:function(a){var b,c,d,e,g=a.selectedIndex,h=[],i=a.options,j=a.type==="select-one";if(g<0)return null;c=j?g:0,d=j?g+1:i.length;for(;c<d;c++){e=i[c];if(e.selected&&(f.support.optDisabled?!e.disabled:e.getAttribute("disabled")===null)&&(!e.parentNode.disabled||!f.nodeName(e.parentNode,"optgroup"))){b=f(e).val();if(j)return b;h.push(b)}}if(j&&!h.length&&i.length)return f(i[g]).val();return h},set:function(a,b){var c=f.makeArray(b);f(a).find("option").each(function(){this.selected=f.inArray(f(this).val(),c)>=0}),c.length||(a.selectedIndex=-1);return c}}},attrFn:{val:!0,css:!0,html:!0,text:!0,data:!0,width:!0,height:!0,offset:!0},attr:function(a,c,d,e){var g,h,i,j=a.nodeType;if(!!a&&j!==3&&j!==8&&j!==2){if(e&&c in f.attrFn)return f(a)[c](d);if(typeof a.getAttribute=="undefined")return f.prop(a,c,d);i=j!==1||!f.isXMLDoc(a),i&&(c=c.toLowerCase(),h=f.attrHooks[c]||(u.test(c)?x:w));if(d!==b){if(d===null){f.removeAttr(a,c);return}if(h&&"set"in h&&i&&(g=h.set(a,d,c))!==b)return g;a.setAttribute(c,""+d);return d}if(h&&"get"in h&&i&&(g=h.get(a,c))!==null)return g;g=a.getAttribute(c);return g===null?b:g}},removeAttr:function(a,b){var c,d,e,g,h,i=0;if(b&&a.nodeType===1){d=b.toLowerCase().split(p),g=d.length;for(;i<g;i++)e=d[i],e&&(c=f.propFix[e]||e,h=u.test(e),h||f.attr(a,e,""),a.removeAttribute(v?e:c),h&&c in a&&(a[c]=!1))}},attrHooks:{type:{set:function(a,b){if(r.test(a.nodeName)&&a.parentNode)f.error("type property can't be changed");else if(!f.support.radioValue&&b==="radio"&&f.nodeName(a,"input")){var c=a.value;a.setAttribute("type",b),c&&(a.value=c);return b}}},value:{get:function(a,b){if(w&&f.nodeName(a,"button"))return w.get(a,b);return b in a?a.value:null},set:function(a,b,c){if(w&&f.nodeName(a,"button"))return w.set(a,b,c);a.value=b}}},propFix:{tabindex:"tabIndex",readonly:"readOnly","for":"htmlFor","class":"className",maxlength:"maxLength",cellspacing:"cellSpacing",cellpadding:"cellPadding",rowspan:"rowSpan",colspan:"colSpan",usemap:"useMap",frameborder:"frameBorder",contenteditable:"contentEditable"},prop:function(a,c,d){var e,g,h,i=a.nodeType;if(!!a&&i!==3&&i!==8&&i!==2){h=i!==1||!f.isXMLDoc(a),h&&(c=f.propFix[c]||c,g=f.propHooks[c]);return d!==b?g&&"set"in g&&(e=g.set(a,d,c))!==b?e:a[c]=d:g&&"get"in g&&(e=g.get(a,c))!==null?e:a[c]}},propHooks:{tabIndex:{get:function(a){var c=a.getAttributeNode("tabindex");return c&&c.specified?parseInt(c.value,10):s.test(a.nodeName)||t.test(a.nodeName)&&a.href?0:b}}}}),f.attrHooks.tabindex=f.propHooks.tabIndex,x={get:function(a,c){var d,e=f.prop(a,c);return e===!0||typeof e!="boolean"&&(d=a.getAttributeNode(c))&&d.nodeValue!==!1?c.toLowerCase():b},set:function(a,b,c){var d;b===!1?f.removeAttr(a,c):(d=f.propFix[c]||c,d in a&&(a[d]=!0),a.setAttribute(c,c.toLowerCase()));return c}},v||(y={name:!0,id:!0,coords:!0},w=f.valHooks.button={get:function(a,c){var d;d=a.getAttributeNode(c);return d&&(y[c]?d.nodeValue!=="":d.specified)?d.nodeValue:b},set:function(a,b,d){var e=a.getAttributeNode(d);e||(e=c.createAttribute(d),a.setAttributeNode(e));return e.nodeValue=b+""}},f.attrHooks.tabindex.set=w.set,f.each(["width","height"],function(a,b){f.attrHooks[b]=f.extend(f.attrHooks[b],{set:function(a,c){if(c===""){a.setAttribute(b,"auto");return c}}})}),f.attrHooks.contenteditable={get:w.get,set:function(a,b,c){b===""&&(b="false"),w.set(a,b,c)}}),f.support.hrefNormalized||f.each(["href","src","width","height"],function(a,c){f.attrHooks[c]=f.extend(f.attrHooks[c],{get:function(a){var d=a.getAttribute(c,2);return d===null?b:d}})}),f.support.style||(f.attrHooks.style={get:function(a){return a.style.cssText.toLowerCase()||b},set:function(a,b){return a.style.cssText=""+b}}),f.support.optSelected||(f.propHooks.selected=f.extend(f.propHooks.selected,{get:function(a){var b=a.parentNode;b&&(b.selectedIndex,b.parentNode&&b.parentNode.selectedIndex);return null}})),f.support.enctype||(f.propFix.enctype="encoding"),f.support.checkOn||f.each(["radio","checkbox"],function(){f.valHooks[this]={get:function(a){return a.getAttribute("value")===null?"on":a.value}}}),f.each(["radio","checkbox"],function(){f.valHooks[this]=f.extend(f.valHooks[this],{set:function(a,b){if(f.isArray(b))return a.checked=f.inArray(f(a).val(),b)>=0}})});var z=/^(?:textarea|input|select)$/i,A=/^([^\.]*)?(?:\.(.+))?$/,B=/(?:^|\s)hover(\.\S+)?\b/,C=/^key/,D=/^(?:mouse|contextmenu)|click/,E=/^(?:focusinfocus|focusoutblur)$/,F=/^(\w*)(?:#([\w\-]+))?(?:\.([\w\-]+))?$/,G=function(
a){var b=F.exec(a);b&&(b[1]=(b[1]||"").toLowerCase(),b[3]=b[3]&&new RegExp("(?:^|\\s)"+b[3]+"(?:\\s|$)"));return b},H=function(a,b){var c=a.attributes||{};return(!b[1]||a.nodeName.toLowerCase()===b[1])&&(!b[2]||(c.id||{}).value===b[2])&&(!b[3]||b[3].test((c["class"]||{}).value))},I=function(a){return f.event.special.hover?a:a.replace(B,"mouseenter$1 mouseleave$1")};f.event={add:function(a,c,d,e,g){var h,i,j,k,l,m,n,o,p,q,r,s;if(!(a.nodeType===3||a.nodeType===8||!c||!d||!(h=f._data(a)))){d.handler&&(p=d,d=p.handler,g=p.selector),d.guid||(d.guid=f.guid++),j=h.events,j||(h.events=j={}),i=h.handle,i||(h.handle=i=function(a){return typeof f!="undefined"&&(!a||f.event.triggered!==a.type)?f.event.dispatch.apply(i.elem,arguments):b},i.elem=a),c=f.trim(I(c)).split(" ");for(k=0;k<c.length;k++){l=A.exec(c[k])||[],m=l[1],n=(l[2]||"").split(".").sort(),s=f.event.special[m]||{},m=(g?s.delegateType:s.bindType)||m,s=f.event.special[m]||{},o=f.extend({type:m,origType:l[1],data:e,handler:d,guid:d.guid,selector:g,quick:g&&G(g),namespace:n.join(".")},p),r=j[m];if(!r){r=j[m]=[],r.delegateCount=0;if(!s.setup||s.setup.call(a,e,n,i)===!1)a.addEventListener?a.addEventListener(m,i,!1):a.attachEvent&&a.attachEvent("on"+m,i)}s.add&&(s.add.call(a,o),o.handler.guid||(o.handler.guid=d.guid)),g?r.splice(r.delegateCount++,0,o):r.push(o),f.event.global[m]=!0}a=null}},global:{},remove:function(a,b,c,d,e){var g=f.hasData(a)&&f._data(a),h,i,j,k,l,m,n,o,p,q,r,s;if(!!g&&!!(o=g.events)){b=f.trim(I(b||"")).split(" ");for(h=0;h<b.length;h++){i=A.exec(b[h])||[],j=k=i[1],l=i[2];if(!j){for(j in o)f.event.remove(a,j+b[h],c,d,!0);continue}p=f.event.special[j]||{},j=(d?p.delegateType:p.bindType)||j,r=o[j]||[],m=r.length,l=l?new RegExp("(^|\\.)"+l.split(".").sort().join("\\.(?:.*\\.)?")+"(\\.|$)"):null;for(n=0;n<r.length;n++)s=r[n],(e||k===s.origType)&&(!c||c.guid===s.guid)&&(!l||l.test(s.namespace))&&(!d||d===s.selector||d==="**"&&s.selector)&&(r.splice(n--,1),s.selector&&r.delegateCount--,p.remove&&p.remove.call(a,s));r.length===0&&m!==r.length&&((!p.teardown||p.teardown.call(a,l)===!1)&&f.removeEvent(a,j,g.handle),delete o[j])}f.isEmptyObject(o)&&(q=g.handle,q&&(q.elem=null),f.removeData(a,["events","handle"],!0))}},customEvent:{getData:!0,setData:!0,changeData:!0},trigger:function(c,d,e,g){if(!e||e.nodeType!==3&&e.nodeType!==8){var h=c.type||c,i=[],j,k,l,m,n,o,p,q,r,s;if(E.test(h+f.event.triggered))return;h.indexOf("!")>=0&&(h=h.slice(0,-1),k=!0),h.indexOf(".")>=0&&(i=h.split("."),h=i.shift(),i.sort());if((!e||f.event.customEvent[h])&&!f.event.global[h])return;c=typeof c=="object"?c[f.expando]?c:new f.Event(h,c):new f.Event(h),c.type=h,c.isTrigger=!0,c.exclusive=k,c.namespace=i.join("."),c.namespace_re=c.namespace?new RegExp("(^|\\.)"+i.join("\\.(?:.*\\.)?")+"(\\.|$)"):null,o=h.indexOf(":")<0?"on"+h:"";if(!e){j=f.cache;for(l in j)j[l].events&&j[l].events[h]&&f.event.trigger(c,d,j[l].handle.elem,!0);return}c.result=b,c.target||(c.target=e),d=d!=null?f.makeArray(d):[],d.unshift(c),p=f.event.special[h]||{};if(p.trigger&&p.trigger.apply(e,d)===!1)return;r=[[e,p.bindType||h]];if(!g&&!p.noBubble&&!f.isWindow(e)){s=p.delegateType||h,m=E.test(s+h)?e:e.parentNode,n=null;for(;m;m=m.parentNode)r.push([m,s]),n=m;n&&n===e.ownerDocument&&r.push([n.defaultView||n.parentWindow||a,s])}for(l=0;l<r.length&&!c.isPropagationStopped();l++)m=r[l][0],c.type=r[l][1],q=(f._data(m,"events")||{})[c.type]&&f._data(m,"handle"),q&&q.apply(m,d),q=o&&m[o],q&&f.acceptData(m)&&q.apply(m,d)===!1&&c.preventDefault();c.type=h,!g&&!c.isDefaultPrevented()&&(!p._default||p._default.apply(e.ownerDocument,d)===!1)&&(h!=="click"||!f.nodeName(e,"a"))&&f.acceptData(e)&&o&&e[h]&&(h!=="focus"&&h!=="blur"||c.target.offsetWidth!==0)&&!f.isWindow(e)&&(n=e[o],n&&(e[o]=null),f.event.triggered=h,e[h](),f.event.triggered=b,n&&(e[o]=n));return c.result}},dispatch:function(c){c=f.event.fix(c||a.event);var d=(f._data(this,"events")||{})[c.type]||[],e=d.delegateCount,g=[].slice.call(arguments,0),h=!c.exclusive&&!c.namespace,i=f.event.special[c.type]||{},j=[],k,l,m,n,o,p,q,r,s,t,u;g[0]=c,c.delegateTarget=this;if(!i.preDispatch||i.preDispatch.call(this,c)!==!1){if(e&&(!c.button||c.type!=="click")){n=f(this),n.context=this.ownerDocument||this;for(m=c.target;m!=this;m=m.parentNode||this)if(m.disabled!==!0){p={},r=[],n[0]=m;for(k=0;k<e;k++)s=d[k],t=s.selector,p[t]===b&&(p[t]=s.quick?H(m,s.quick):n.is(t)),p[t]&&r.push(s);r.length&&j.push({elem:m,matches:r})}}d.length>e&&j.push({elem:this,matches:d.slice(e)});for(k=0;k<j.length&&!c.isPropagationStopped();k++){q=j[k],c.currentTarget=q.elem;for(l=0;l<q.matches.length&&!c.isImmediatePropagationStopped();l++){s=q.matches[l];if(h||!c.namespace&&!s.namespace||c.namespace_re&&c.namespace_re.test(s.namespace))c.data=s.data,c.handleObj=s,o=((f.event.special[s.origType]||{}).handle||s.handler).apply(q.elem,g),o!==b&&(c.result=o,o===!1&&(c.preventDefault(),c.stopPropagation()))}}i.postDispatch&&i.postDispatch.call(this,c);return c.result}},props:"attrChange attrName relatedNode srcElement altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),fixHooks:{},keyHooks:{props:"char charCode key keyCode".split(" "),filter:function(a,b){a.which==null&&(a.which=b.charCode!=null?b.charCode:b.keyCode);return a}},mouseHooks:{props:"button buttons clientX clientY fromElement offsetX offsetY pageX pageY screenX screenY toElement".split(" "),filter:function(a,d){var e,f,g,h=d.button,i=d.fromElement;a.pageX==null&&d.clientX!=null&&(e=a.target.ownerDocument||c,f=e.documentElement,g=e.body,a.pageX=d.clientX+(f&&f.scrollLeft||g&&g.scrollLeft||0)-(f&&f.clientLeft||g&&g.clientLeft||0),a.pageY=d.clientY+(f&&f.scrollTop||g&&g.scrollTop||0)-(f&&f.clientTop||g&&g.clientTop||0)),!a.relatedTarget&&i&&(a.relatedTarget=i===a.target?d.toElement:i),!a.which&&h!==b&&(a.which=h&1?1:h&2?3:h&4?2:0);return a}},fix:function(a){if(a[f.expando])return a;var d,e,g=a,h=f.event.fixHooks[a.type]||{},i=h.props?this.props.concat(h.props):this.props;a=f.Event(g);for(d=i.length;d;)e=i[--d],a[e]=g[e];a.target||(a.target=g.srcElement||c),a.target.nodeType===3&&(a.target=a.target.parentNode),a.metaKey===b&&(a.metaKey=a.ctrlKey);return h.filter?h.filter(a,g):a},special:{ready:{setup:f.bindReady},load:{noBubble:!0},focus:{delegateType:"focusin"},blur:{delegateType:"focusout"},beforeunload:{setup:function(a,b,c){f.isWindow(this)&&(this.onbeforeunload=c)},teardown:function(a,b){this.onbeforeunload===b&&(this.onbeforeunload=null)}}},simulate:function(a,b,c,d){var e=f.extend(new f.Event,c,{type:a,isSimulated:!0,originalEvent:{}});d?f.event.trigger(e,null,b):f.event.dispatch.call(b,e),e.isDefaultPrevented()&&c.preventDefault()}},f.event.handle=f.event.dispatch,f.removeEvent=c.removeEventListener?function(a,b,c){a.removeEventListener&&a.removeEventListener(b,c,!1)}:function(a,b,c){a.detachEvent&&a.detachEvent("on"+b,c)},f.Event=function(a,b){if(!(this instanceof f.Event))return new f.Event(a,b);a&&a.type?(this.originalEvent=a,this.type=a.type,this.isDefaultPrevented=a.defaultPrevented||a.returnValue===!1||a.getPreventDefault&&a.getPreventDefault()?K:J):this.type=a,b&&f.extend(this,b),this.timeStamp=a&&a.timeStamp||f.now(),this[f.expando]=!0},f.Event.prototype={preventDefault:function(){this.isDefaultPrevented=K;var a=this.originalEvent;!a||(a.preventDefault?a.preventDefault():a.returnValue=!1)},stopPropagation:function(){this.isPropagationStopped=K;var a=this.originalEvent;!a||(a.stopPropagation&&a.stopPropagation(),a.cancelBubble=!0)},stopImmediatePropagation:function(){this.isImmediatePropagationStopped=K,this.stopPropagation()},isDefaultPrevented:J,isPropagationStopped:J,isImmediatePropagationStopped:J},f.each({mouseenter:"mouseover",mouseleave:"mouseout"},function(a,b){f.event.special[a]={delegateType:b,bindType:b,handle:function(a){var c=this,d=a.relatedTarget,e=a.handleObj,g=e.selector,h;if(!d||d!==c&&!f.contains(c,d))a.type=e.origType,h=e.handler.apply(this,arguments),a.type=b;return h}}}),f.support.submitBubbles||(f.event.special.submit={setup:function(){if(f.nodeName(this,"form"))return!1;f.event.add(this,"click._submit keypress._submit",function(a){var c=a.target,d=f.nodeName(c,"input")||f.nodeName(c,"button")?c.form:b;d&&!d._submit_attached&&(f.event.add(d,"submit._submit",function(a){a._submit_bubble=!0}),d._submit_attached=!0)})},postDispatch:function(a){a._submit_bubble&&(delete a._submit_bubble,this.parentNode&&!a.isTrigger&&f.event.simulate("submit",this.parentNode,a,!0))},teardown:function(){if(f.nodeName(this,"form"))return!1;f.event.remove(this,"._submit")}}),f.support.changeBubbles||(f.event.special.change={setup:function(){if(z.test(this.nodeName)){if(this.type==="checkbox"||this.type==="radio")f.event.add(this,"propertychange._change",function(a){a.originalEvent.propertyName==="checked"&&(this._just_changed=!0)}),f.event.add(this,"click._change",function(a){this._just_changed&&!a.isTrigger&&(this._just_changed=!1,f.event.simulate("change",this,a,!0))});return!1}f.event.add(this,"beforeactivate._change",function(a){var b=a.target;z.test(b.nodeName)&&!b._change_attached&&(f.event.add(b,"change._change",function(a){this.parentNode&&!a.isSimulated&&!a.isTrigger&&f.event.simulate("change",this.parentNode,a,!0)}),b._change_attached=!0)})},handle:function(a){var b=a.target;if(this!==b||a.isSimulated||a.isTrigger||b.type!=="radio"&&b.type!=="checkbox")return a.handleObj.handler.apply(this,arguments)},teardown:function(){f.event.remove(this,"._change");return z.test(this.nodeName)}}),f.support.focusinBubbles||f.each({focus:"focusin",blur:"focusout"},function(a,b){var d=0,e=function(a){f.event.simulate(b,a.target,f.event.fix(a),!0)};f.event.special[b]={setup:function(){d++===0&&c.addEventListener(a,e,!0)},teardown:function(){--d===0&&c.removeEventListener(a,e,!0)}}}),f.fn.extend({on:function(a,c,d,e,g){var h,i;if(typeof a=="object"){typeof c!="string"&&(d=d||c,c=b);for(i in a)this.on(i,c,d,a[i],g);return this}d==null&&e==null?(e=c,d=c=b):e==null&&(typeof c=="string"?(e=d,d=b):(e=d,d=c,c=b));if(e===!1)e=J;else if(!e)return this;g===1&&(h=e,e=function(a){f().off(a);return h.apply(this,arguments)},e.guid=h.guid||(h.guid=f.guid++));return this.each(function(){f.event.add(this,a,e,d,c)})},one:function(a,b,c,d){return this.on(a,b,c,d,1)},off:function(a,c,d){if(a&&a.preventDefault&&a.handleObj){var e=a.handleObj;f(a.delegateTarget).off(e.namespace?e.origType+"."+e.namespace:e.origType,e.selector,e.handler);return this}if(typeof a=="object"){for(var g in a)this.off(g,c,a[g]);return this}if(c===!1||typeof c=="function")d=c,c=b;d===!1&&(d=J);return this.each(function(){f.event.remove(this,a,d,c)})},bind:function(a,b,c){return this.on(a,null,b,c)},unbind:function(a,b){return this.off(a,null,b)},live:function(a,b,c){f(this.context).on(a,this.selector,b,c);return this},die:function(a,b){f(this.context).off(a,this.selector||"**",b);return this},delegate:function(a,b,c,d){return this.on(b,a,c,d)},undelegate:function(a,b,c){return arguments.length==1?this.off(a,"**"):this.off(b,a,c)},trigger:function(a,b){return this.each(function(){f.event.trigger(a,b,this)})},triggerHandler:function(a,b){if(this[0])return f.event.trigger(a,b,this[0],!0)},toggle:function(a){var b=arguments,c=a.guid||f.guid++,d=0,e=function(c){var e=(f._data(this,"lastToggle"+a.guid)||0)%d;f._data(this,"lastToggle"+a.guid,e+1),c.preventDefault();return b[e].apply(this,arguments)||!1};e.guid=c;while(d<b.length)b[d++].guid=c;return this.click(e)},hover:function(a,b){return this.mouseenter(a).mouseleave(b||a)}}),f.each("blur focus focusin focusout load resize scroll unload click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change select submit keydown keypress keyup error contextmenu".split(" "),function(a,b){f.fn[b]=function(a,c){c==null&&(c=a,a=null);return arguments.length>0?this.on(b,null,a,c):this.trigger(b)},f.attrFn&&(f.attrFn[b]=!0),C.test(b)&&(f.event.fixHooks[b]=f.event.keyHooks),D.test(b)&&(f.event.fixHooks[b]=f.event.mouseHooks)}),function(){function x(a,b,c,e,f,g){for(var h=0,i=e.length;h<i;h++){var j=e[h];if(j){var k=!1;j=j[a];while(j){if(j[d]===c){k=e[j.sizset];break}if(j.nodeType===1){g||(j[d]=c,j.sizset=h);if(typeof b!="string"){if(j===b){k=!0;break}}else if(m.filter(b,[j]).length>0){k=j;break}}j=j[a]}e[h]=k}}}function w(a,b,c,e,f,g){for(var h=0,i=e.length;h<i;h++){var j=e[h];if(j){var k=!1;j=j[a];while(j){if(j[d]===c){k=e[j.sizset];break}j.nodeType===1&&!g&&(j[d]=c,j.sizset=h);if(j.nodeName.toLowerCase()===b){k=j;break}j=j[a]}e[h]=k}}}var a=/((?:\((?:\([^()]+\)|[^()]+)+\)|\[(?:\[[^\[\]]*\]|['"][^'"]*['"]|[^\[\]'"]+)+\]|\\.|[^ >+~,(\[\\]+)+|[>+~])(\s*,\s*)?((?:.|\r|\n)*)/g,d="sizcache"+(Math.random()+"").replace(".",""),e=0,g=Object.prototype.toString,h=!1,i=!0,j=/\\/g,k=/\r\n/g,l=/\W/;[0,0].sort(function(){i=!1;return 0});var m=function(b,d,e,f){e=e||[],d=d||c;var h=d;if(d.nodeType!==1&&d.nodeType!==9)return[];if(!b||typeof b!="string")return e;var i,j,k,l,n,q,r,t,u=!0,v=m.isXML(d),w=[],x=b;do{a.exec(""),i=a.exec(x);if(i){x=i[3],w.push(i[1]);if(i[2]){l=i[3];break}}}while(i);if(w.length>1&&p.exec(b))if(w.length===2&&o.relative[w[0]])j=y(w[0]+w[1],d,f);else{j=o.relative[w[0]]?[d]:m(w.shift(),d);while(w.length)b=w.shift(),o.relative[b]&&(b+=w.shift()),j=y(b,j,f)}else{!f&&w.length>1&&d.nodeType===9&&!v&&o.match.ID.test(w[0])&&!o.match.ID.test(w[w.length-1])&&(n=m.find(w.shift(),d,v),d=n.expr?m.filter(n.expr,n.set)[0]:n.set[0]);if(d){n=f?{expr:w.pop(),set:s(f)}:m.find(w.pop(),w.length===1&&(w[0]==="~"||w[0]==="+")&&d.parentNode?d.parentNode:d,v),j=n.expr?m.filter(n.expr,n.set):n.set,w.length>0?k=s(j):u=!1;while(w.length)q=w.pop(),r=q,o.relative[q]?r=w.pop():q="",r==null&&(r=d),o.relative[q](k,r,v)}else k=w=[]}k||(k=j),k||m.error(q||b);if(g.call(k)==="[object Array]")if(!u)e.push.apply(e,k);else if(d&&d.nodeType===1)for(t=0;k[t]!=null;t++)k[t]&&(k[t]===!0||k[t].nodeType===1&&m.contains(d,k[t]))&&e.push(j[t]);else for(t=0;k[t]!=null;t++)k[t]&&k[t].nodeType===1&&e.push(j[t]);else s(k,e);l&&(m(l,h,e,f),m.uniqueSort(e));return e};m.uniqueSort=function(a){if(u){h=i,a.sort(u);if(h)for(var b=1;b<a.length;b++)a[b]===a[b-1]&&a.splice(b--,1)}return a},m.matches=function(a,b){return m(a,null,null,b)},m.matchesSelector=function(a,b){return m(b,null,null,[a]).length>0},m.find=function(a,b,c){var d,e,f,g,h,i;if(!a)return[];for(e=0,f=o.order.length;e<f;e++){h=o.order[e];if(g=o.leftMatch[h].exec(a)){i=g[1],g.splice(1,1);if(i.substr(i.length-1)!=="\\"){g[1]=(g[1]||"").replace(j,""),d=o.find[h](g,b,c);if(d!=null){a=a.replace(o.match[h],"");break}}}}d||(d=typeof b.getElementsByTagName!="undefined"?b.getElementsByTagName("*"):[]);return{set:d,expr:a}},m.filter=function(a,c,d,e){var f,g,h,i,j,k,l,n,p,q=a,r=[],s=c,t=c&&c[0]&&m.isXML(c[0]);while(a&&c.length){for(h in o.filter)if((f=o.leftMatch[h].exec(a))!=null&&f[2]){k=o.filter[h],l=f[1],g=!1,f.splice(1,1);if(l.substr(l.length-1)==="\\")continue;s===r&&(r=[]);if(o.preFilter[h]){f=o.preFilter[h](f,s,d,r,e,t);if(!f)g=i=!0;else if(f===!0)continue}if(f)for(n=0;(j=s[n])!=null;n++)j&&(i=k(j,f,n,s),p=e^i,d&&i!=null?p?g=!0:s[n]=!1:p&&(r.push(j),g=!0));if(i!==b){d||(s=r),a=a.replace(o.match[h],"");if(!g)return[];break}}if(a===q)if(g==null)m.error(a);else break;q=a}return s},m.error=function(a){throw new Error("Syntax error, unrecognized expression: "+a)};var n=m.getText=function(a){var b,c,d=a.nodeType,e="";if(d){if(d===1||d===9||d===11){if(typeof a.textContent=="string")return a.textContent;if(typeof a.innerText=="string")return a.innerText.replace(k,"");for(a=a.firstChild;a;a=a.nextSibling)e+=n(a)}else if(d===3||d===4)return a.nodeValue}else for(b=0;c=a[b];b++)c.nodeType!==8&&(e+=n(c));return e},o=m.selectors={order:["ID","NAME","TAG"],match:{ID:/#((?:[\w\u00c0-\uFFFF\-]|\\.)+)/,CLASS:/\.((?:[\w\u00c0-\uFFFF\-]|\\.)+)/,NAME:/\[name=['"]*((?:[\w\u00c0-\uFFFF\-]|\\.)+)['"]*\]/,ATTR:/\[\s*((?:[\w\u00c0-\uFFFF\-]|\\.)+)\s*(?:(\S?=)\s*(?:(['"])(.*?)\3|(#?(?:[\w\u00c0-\uFFFF\-]|\\.)*)|)|)\s*\]/,TAG:/^((?:[\w\u00c0-\uFFFF\*\-]|\\.)+)/,CHILD:/:(only|nth|last|first)-child(?:\(\s*(even|odd|(?:[+\-]?\d+|(?:[+\-]?\d*)?n\s*(?:[+\-]\s*\d+)?))\s*\))?/,POS:/:(nth|eq|gt|lt|first|last|even|odd)(?:\((\d*)\))?(?=[^\-]|$)/,PSEUDO:/:((?:[\w\u00c0-\uFFFF\-]|\\.)+)(?:\((['"]?)((?:\([^\)]+\)|[^\(\)]*)+)\2\))?/},leftMatch:{},attrMap:{"class":"className","for":"htmlFor"},attrHandle:{href:function(a){return a.getAttribute("href")},type:function(a){return a.getAttribute("type")}},relative:{"+":function(a,b){var c=typeof b=="string",d=c&&!l.test(b),e=c&&!d;d&&(b=b.toLowerCase());for(var f=0,g=a.length,h;f<g;f++)if(h=a[f]){while((h=h.previousSibling)&&h.nodeType!==1);a[f]=e||h&&h.nodeName.toLowerCase()===b?h||!1:h===b}e&&m.filter(b,a,!0)},">":function(a,b){var c,d=typeof b=="string",e=0,f=a.length;if(d&&!l.test(b)){b=b.toLowerCase();for(;e<f;e++){c=a[e];if(c){var g=c.parentNode;a[e]=g.nodeName.toLowerCase()===b?g:!1}}}else{for(;e<f;e++)c=a[e],c&&(a[e]=d?c.parentNode:c.parentNode===b);d&&m.filter(b,a,!0)}},"":function(a,b,c){var d,f=e++,g=x;typeof b=="string"&&!l.test(b)&&(b=b.toLowerCase(),d=b,g=w),g("parentNode",b,f,a,d,c)},"~":function(a,b,c){var d,f=e++,g=x;typeof b=="string"&&!l.test(b)&&(b=b.toLowerCase(),d=b,g=w),g("previousSibling",b,f,a,d,c)}},find:{ID:function(a,b,c){if(typeof b.getElementById!="undefined"&&!c){var d=b.getElementById(a[1]);return d&&d.parentNode?[d]:[]}},NAME:function(a,b){if(typeof b.getElementsByName!="undefined"){var c=[],d=b.getElementsByName(a[1]);for(var e=0,f=d.length;e<f;e++)d[e].getAttribute("name")===a[1]&&c.push(d[e]);return c.length===0?null:c}},TAG:function(a,b){if(typeof b.getElementsByTagName!="undefined")return b.getElementsByTagName(a[1])}},preFilter:{CLASS:function(a,b,c,d,e,f){a=" "+a[1].replace(j,"")+" ";if(f)return a;for(var g=0,h;(h=b[g])!=null;g++)h&&(e^(h.className&&(" "+h.className+" ").replace(/[\t\n\r]/g," ").indexOf(a)>=0)?c||d.push(h):c&&(b[g]=!1));return!1},ID:function(a){return a[1].replace(j,"")},TAG:function(a,b){return a[1].replace(j,"").toLowerCase()},CHILD:function(a){if(a[1]==="nth"){a[2]||m.error(a[0]),a[2]=a[2].replace(/^\+|\s*/g,"");var b=/(-?)(\d*)(?:n([+\-]?\d*))?/.exec(a[2]==="even"&&"2n"||a[2]==="odd"&&"2n+1"||!/\D/.test(a[2])&&"0n+"+a[2]||a[2]);a[2]=b[1]+(b[2]||1)-0,a[3]=b[3]-0}else a[2]&&m.error(a[0]);a[0]=e++;return a},ATTR:function(a,b,c,d,e,f){var g=a[1]=a[1].replace(j,"");!f&&o.attrMap[g]&&(a[1]=o.attrMap[g]),a[4]=(a[4]||a[5]||"").replace(j,""),a[2]==="~="&&(a[4]=" "+a[4]+" ");return a},PSEUDO:function(b,c,d,e,f){if(b[1]==="not")if((a.exec(b[3])||"").length>1||/^\w/.test(b[3]))b[3]=m(b[3],null,null,c);else{var g=m.filter(b[3],c,d,!0^f);d||e.push.apply(e,g);return!1}else if(o.match.POS.test(b[0])||o.match.CHILD.test(b[0]))return!0;return b},POS:function(a){a.unshift(!0);return a}},filters:{enabled:function(a){return a.disabled===!1&&a.type!=="hidden"},disabled:function(a){return a.disabled===!0},checked:function(a){return a.checked===!0},selected:function(a){a.parentNode&&a.parentNode.selectedIndex;return a.selected===!0},parent:function(a){return!!a.firstChild},empty:function(a){return!a.firstChild},has:function(a,b,c){return!!m(c[3],a).length},header:function(a){return/h\d/i.test(a.nodeName)},text:function(a){var b=a.getAttribute("type"),c=a.type;return a.nodeName.toLowerCase()==="input"&&"text"===c&&(b===c||b===null)},radio:function(a){return a.nodeName.toLowerCase()==="input"&&"radio"===a.type},checkbox:function(a){return a.nodeName.toLowerCase()==="input"&&"checkbox"===a.type},file:function(a){return a.nodeName.toLowerCase()==="input"&&"file"===a.type},password:function(a){return a.nodeName.toLowerCase()==="input"&&"password"===a.type},submit:function(a){var b=a.nodeName.toLowerCase();return(b==="input"||b==="button")&&"submit"===a.type},image:function(a){return a.nodeName.toLowerCase()==="input"&&"image"===a.type},reset:function(a){var b=a.nodeName.toLowerCase();return(b==="input"||b==="button")&&"reset"===a.type},button:function(a){var b=a.nodeName.toLowerCase();return b==="input"&&"button"===a.type||b==="button"},input:function(a){return/input|select|textarea|button/i.test(a.nodeName)},focus:function(a){return a===a.ownerDocument.activeElement}},setFilters:{first:function(a,b){return b===0},last:function(a,b,c,d){return b===d.length-1},even:function(a,b){return b%2===0},odd:function(a,b){return b%2===1},lt:function(a,b,c){return b<c[3]-0},gt:function(a,b,c){return b>c[3]-0},nth:function(a,b,c){return c[3]-0===b},eq:function(a,b,c){return c[3]-0===b}},filter:{PSEUDO:function(a,b,c,d){var e=b[1],f=o.filters[e];if(f)return f(a,c,b,d);if(e==="contains")return(a.textContent||a.innerText||n([a])||"").indexOf(b[3])>=0;if(e==="not"){var g=b[3];for(var h=0,i=g.length;h<i;h++)if(g[h]===a)return!1;return!0}m.error(e)},CHILD:function(a,b){var c,e,f,g,h,i,j,k=b[1],l=a;switch(k){case"only":case"first":while(l=l.previousSibling)if(l.nodeType===1)return!1;if(k==="first")return!0;l=a;case"last":while(l=l.nextSibling)if(l.nodeType===1)return!1;return!0;case"nth":c=b[2],e=b[3];if(c===1&&e===0)return!0;f=b[0],g=a.parentNode;if(g&&(g[d]!==f||!a.nodeIndex)){i=0;for(l=g.firstChild;l;l=l.nextSibling)l.nodeType===1&&(l.nodeIndex=++i);g[d]=f}j=a.nodeIndex-e;return c===0?j===0:j%c===0&&j/c>=0}},ID:function(a,b){return a.nodeType===1&&a.getAttribute("id")===b},TAG:function(a,b){return b==="*"&&a.nodeType===1||!!a.nodeName&&a.nodeName.toLowerCase()===b},CLASS:function(a,b){return(" "+(a.className||a.getAttribute("class"))+" ").indexOf(b)>-1},ATTR:function(a,b){var c=b[1],d=m.attr?m.attr(a,c):o.attrHandle[c]?o.attrHandle[c](a):a[c]!=null?a[c]:a.getAttribute(c),e=d+"",f=b[2],g=b[4];return d==null?f==="!=":!f&&m.attr?d!=null:f==="="?e===g:f==="*="?e.indexOf(g)>=0:f==="~="?(" "+e+" ").indexOf(g)>=0:g?f==="!="?e!==g:f==="^="?e.indexOf(g)===0:f==="$="?e.substr(e.length-g.length)===g:f==="|="?e===g||e.substr(0,g.length+1)===g+"-":!1:e&&d!==!1},POS:function(a,b,c,d){var e=b[2],f=o.setFilters[e];if(f)return f(a,c,b,d)}}},p=o.match.POS,q=function(a,b){return"\\"+(b-0+1)};for(var r in o.match)o.match[r]=new RegExp(o.match[r].source+/(?![^\[]*\])(?![^\(]*\))/.source),o.leftMatch[r]=new RegExp(/(^(?:.|\r|\n)*?)/.source+o.match[r].source.replace(/\\(\d+)/g,q));o.match.globalPOS=p;var s=function(a,b){a=Array.prototype.slice.call(a,0);if(b){b.push.apply(b,a);return b}return a};try{Array.prototype.slice.call(c.documentElement.childNodes,0)[0].nodeType}catch(t){s=function(a,b){var c=0,d=b||[];if(g.call(a)==="[object Array]")Array.prototype.push.apply(d,a);else if(typeof a.length=="number")for(var e=a.length;c<e;c++)d.push(a[c]);else for(;a[c];c++)d.push(a[c]);return d}}var u,v;c.documentElement.compareDocumentPosition?u=function(a,b){if(a===b){h=!0;return 0}if(!a.compareDocumentPosition||!b.compareDocumentPosition)return a.compareDocumentPosition?-1:1;return a.compareDocumentPosition(b)&4?-1:1}:(u=function(a,b){if(a===b){h=!0;return 0}if(a.sourceIndex&&b.sourceIndex)return a.sourceIndex-b.sourceIndex;var c,d,e=[],f=[],g=a.parentNode,i=b.parentNode,j=g;if(g===i)return v(a,b);if(!g)return-1;if(!i)return 1;while(j)e.unshift(j),j=j.parentNode;j=i;while(j)f.unshift(j),j=j.parentNode;c=e.length,d=f.length;for(var k=0;k<c&&k<d;k++)if(e[k]!==f[k])return v(e[k],f[k]);return k===c?v(a,f[k],-1):v(e[k],b,1)},v=function(a,b,c){if(a===b)return c;var d=a.nextSibling;while(d){if(d===b)return-1;d=d.nextSibling}return 1}),function(){var a=c.createElement("div"),d="script"+(new Date).getTime(),e=c.documentElement;a.innerHTML="<a name='"+d+"'/>",e.insertBefore(a,e.firstChild),c.getElementById(d)&&(o.find.ID=function(a,c,d){if(typeof c.getElementById!="undefined"&&!d){var e=c.getElementById(a[1]);return e?e.id===a[1]||typeof e.getAttributeNode!="undefined"&&e.getAttributeNode("id").nodeValue===a[1]?[e]:b:[]}},o.filter.ID=function(a,b){var c=typeof a.getAttributeNode!="undefined"&&a.getAttributeNode("id");return a.nodeType===1&&c&&c.nodeValue===b}),e.removeChild(a),e=a=null}(),function(){var a=c.createElement("div");a.appendChild(c.createComment("")),a.getElementsByTagName("*").length>0&&(o.find.TAG=function(a,b){var c=b.getElementsByTagName(a[1]);if(a[1]==="*"){var d=[];for(var e=0;c[e];e++)c[e].nodeType===1&&d.push(c[e]);c=d}return c}),a.innerHTML="<a href='#'></a>",a.firstChild&&typeof a.firstChild.getAttribute!="undefined"&&a.firstChild.getAttribute("href")!=="#"&&(o.attrHandle.href=function(a){return a.getAttribute("href",2)}),a=null}(),c.querySelectorAll&&function(){var a=m,b=c.createElement("div"),d="__sizzle__";b.innerHTML="<p class='TEST'></p>";if(!b.querySelectorAll||b.querySelectorAll(".TEST").length!==0){m=function(b,e,f,g){e=e||c;if(!g&&!m.isXML(e)){var h=/^(\w+$)|^\.([\w\-]+$)|^#([\w\-]+$)/.exec(b);if(h&&(e.nodeType===1||e.nodeType===9)){if(h[1])return s(e.getElementsByTagName(b),f);if(h[2]&&o.find.CLASS&&e.getElementsByClassName)return s(e.getElementsByClassName(h[2]),f)}if(e.nodeType===9){if(b==="body"&&e.body)return s([e.body],f);if(h&&h[3]){var i=e.getElementById(h[3]);if(!i||!i.parentNode)return s([],f);if(i.id===h[3])return s([i],f)}try{return s(e.querySelectorAll(b),f)}catch(j){}}else if(e.nodeType===1&&e.nodeName.toLowerCase()!=="object"){var k=e,l=e.getAttribute("id"),n=l||d,p=e.parentNode,q=/^\s*[+~]/.test(b);l?n=n.replace(/'/g,"\\$&"):e.setAttribute("id",n),q&&p&&(e=e.parentNode);try{if(!q||p)return s(e.querySelectorAll("[id='"+n+"'] "+b),f)}catch(r){}finally{l||k.removeAttribute("id")}}}return a(b,e,f,g)};for(var e in a)m[e]=a[e];b=null}}(),function(){var a=c.documentElement,b=a.matchesSelector||a.mozMatchesSelector||a.webkitMatchesSelector||a.msMatchesSelector;if(b){var d=!b.call(c.createElement("div"),"div"),e=!1;try{b.call(c.documentElement,"[test!='']:sizzle")}catch(f){e=!0}m.matchesSelector=function(a,c){c=c.replace(/\=\s*([^'"\]]*)\s*\]/g,"='$1']");if(!m.isXML(a))try{if(e||!o.match.PSEUDO.test(c)&&!/!=/.test(c)){var f=b.call(a,c);if(f||!d||a.document&&a.document.nodeType!==11)return f}}catch(g){}return m(c,null,null,[a]).length>0}}}(),function(){var a=c.createElement("div");a.innerHTML="<div class='test e'></div><div class='test'></div>";if(!!a.getElementsByClassName&&a.getElementsByClassName("e").length!==0){a.lastChild.className="e";if(a.getElementsByClassName("e").length===1)return;o.order.splice(1,0,"CLASS"),o.find.CLASS=function(a,b,c){if(typeof b.getElementsByClassName!="undefined"&&!c)return b.getElementsByClassName(a[1])},a=null}}(),c.documentElement.contains?m.contains=function(a,b){return a!==b&&(a.contains?a.contains(b):!0)}:c.documentElement.compareDocumentPosition?m.contains=function(a,b){return!!(a.compareDocumentPosition(b)&16)}:m.contains=function(){return!1},m.isXML=function(a){var b=(a?a.ownerDocument||a:0).documentElement;return b?b.nodeName!=="HTML":!1};var y=function(a,b,c){var d,e=[],f="",g=b.nodeType?[b]:b;while(d=o.match.PSEUDO.exec(a))f+=d[0],a=a.replace(o.match.PSEUDO,"");a=o.relative[a]?a+"*":a;for(var h=0,i=g.length;h<i;h++)m(a,g[h],e,c);return m.filter(f,e)};m.attr=f.attr,m.selectors.attrMap={},f.find=m,f.expr=m.selectors,f.expr[":"]=f.expr.filters,f.unique=m.uniqueSort,f.text=m.getText,f.isXMLDoc=m.isXML,f.contains=m.contains}();var L=/Until$/,M=/^(?:parents|prevUntil|prevAll)/,N=/,/,O=/^.[^:#\[\.,]*$/,P=Array.prototype.slice,Q=f.expr.match.globalPOS,R={children:!0,contents:!0,next:!0,prev:!0};f.fn.extend({find:function(a){var b=this,c,d;if(typeof a!="string")return f(a).filter(function(){for(c=0,d=b.length;c<d;c++)if(f.contains(b[c],this))return!0});var e=this.pushStack("","find",a),g,h,i;for(c=0,d=this.length;c<d;c++){g=e.length,f.find(a,this[c],e);if(c>0)for(h=g;h<e.length;h++)for(i=0;i<g;i++)if(e[i]===e[h]){e.splice(h--,1);break}}return e},has:function(a){var b=f(a);return this.filter(function(){for(var a=0,c=b.length;a<c;a++)if(f.contains(this,b[a]))return!0})},not:function(a){return this.pushStack(T(this,a,!1),"not",a)},filter:function(a){return this.pushStack(T(this,a,!0),"filter",a)},is:function(a){return!!a&&(typeof a=="string"?Q.test(a)?f(a,this.context).index(this[0])>=0:f.filter(a,this).length>0:this.filter(a).length>0)},closest:function(a,b){var c=[],d,e,g=this[0];if(f.isArray(a)){var h=1;while(g&&g.ownerDocument&&g!==b){for(d=0;d<a.length;d++)f(g).is(a[d])&&c.push({selector:a[d],elem:g,level:h});g=g.parentNode,h++}return c}var i=Q.test(a)||typeof a!="string"?f(a,b||this.context):0;for(d=0,e=this.length;d<e;d++){g=this[d];while(g){if(i?i.index(g)>-1:f.find.matchesSelector(g,a)){c.push(g);break}g=g.parentNode;if(!g||!g.ownerDocument||g===b||g.nodeType===11)break}}c=c.length>1?f.unique(c):c;return this.pushStack(c,"closest",a)},index:function(a){if(!a)return this[0]&&this[0].parentNode?this.prevAll().length:-1;if(typeof a=="string")return f.inArray(this[0],f(a));return f.inArray(a.jquery?a[0]:a,this)},add:function(a,b){var c=typeof a=="string"?f(a,b):f.makeArray(a&&a.nodeType?[a]:a),d=f.merge(this.get(),c);return this.pushStack(S(c[0])||S(d[0])?d:f.unique(d))},andSelf:function(){return this.add(this.prevObject)}}),f.each({parent:function(a){var b=a.parentNode;return b&&b.nodeType!==11?b:null},parents:function(a){return f.dir(a,"parentNode")},parentsUntil:function(a,b,c){return f.dir(a,"parentNode",c)},next:function(a){return f.nth(a,2,"nextSibling")},prev:function(a){return f.nth(a,2,"previousSibling")},nextAll:function(a){return f.dir(a,"nextSibling")},prevAll:function(a){return f.dir(a,"previousSibling")},nextUntil:function(a,b,c){return f.dir(a,"nextSibling",c)},prevUntil:function(a,b,c){return f.dir(a,"previousSibling",c)},siblings:function(a){return f.sibling((a.parentNode||{}).firstChild,a)},children:function(a){return f.sibling(a.firstChild)},contents:function(a){return f.nodeName(a,"iframe")?a.contentDocument||a.contentWindow.document:f.makeArray(a.childNodes)}},function(a,b){f.fn[a]=function(c,d){var e=f.map(this,b,c);L.test(a)||(d=c),d&&typeof d=="string"&&(e=f.filter(d,e)),e=this.length>1&&!R[a]?f.unique(e):e,(this.length>1||N.test(d))&&M.test(a)&&(e=e.reverse());return this.pushStack(e,a,P.call(arguments).join(","))}}),f.extend({filter:function(a,b,c){c&&(a=":not("+a+")");return b.length===1?f.find.matchesSelector(b[0],a)?[b[0]]:[]:f.find.matches(a,b)},dir:function(a,c,d){var e=[],g=a[c];while(g&&g.nodeType!==9&&(d===b||g.nodeType!==1||!f(g).is(d)))g.nodeType===1&&e.push(g),g=g[c];return e},nth:function(a,b,c,d){b=b||1;var e=0;for(;a;a=a[c])if(a.nodeType===1&&++e===b)break;return a},sibling:function(a,b){var c=[];for(;a;a=a.nextSibling)a.nodeType===1&&a!==b&&c.push(a);return c}});var V="abbr|article|aside|audio|bdi|canvas|data|datalist|details|figcaption|figure|footer|header|hgroup|mark|meter|nav|output|progress|section|summary|time|video",W=/ jQuery\d+="(?:\d+|null)"/g,X=/^\s+/,Y=/<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/ig,Z=/<([\w:]+)/,$=/<tbody/i,_=/<|&#?\w+;/,ba=/<(?:script|style)/i,bb=/<(?:script|object|embed|option|style)/i,bc=new RegExp("<(?:"+V+")[\\s/>]","i"),bd=/checked\s*(?:[^=]|=\s*.checked.)/i,be=/\/(java|ecma)script/i,bf=/^\s*<!(?:\[CDATA\[|\-\-)/,bg={option:[1,"<select multiple='multiple'>","</select>"],legend:[1,"<fieldset>","</fieldset>"],thead:[1,"<table>","</table>"],tr:[2,"<table><tbody>","</tbody></table>"],td:[3,"<table><tbody><tr>","</tr></tbody></table>"],col:[2,"<table><tbody></tbody><colgroup>","</colgroup></table>"],area:[1,"<map>","</map>"],_default:[0,"",""]},bh=U(c);bg.optgroup=bg.option,bg.tbody=bg.tfoot=bg.colgroup=bg.caption=bg.thead,bg.th=bg.td,f.support.htmlSerialize||(bg._default=[1,"div<div>","</div>"]),f.fn.extend({text:function(a){return f.access(this,function(a){return a===b?f.text(this):this.empty().append((this[0]&&this[0].ownerDocument||c).createTextNode(a))},null,a,arguments.length)},wrapAll:function(a){if(f.isFunction(a))return this.each(function(b){f(this).wrapAll(a.call(this,b))});if(this[0]){var b=f(a,this[0].ownerDocument).eq(0).clone(!0);this[0].parentNode&&b.insertBefore(this[0]),b.map(function(){var a=this;while(a.firstChild&&a.firstChild.nodeType===1)a=a.firstChild;return a}).append(this)}return this},wrapInner:function(a){if(f.isFunction(a))return this.each(function(b){f(this).wrapInner(a.call(this,b))});return this.each(function(){var b=f(this),c=b.contents();c.length?c.wrapAll(a):b.append(a)})},wrap:function(a){var b=f.isFunction(a);return this.each(function(c){f(this).wrapAll(b?a.call(this,c):a)})},unwrap:function(){return this.parent().each(function(){f.nodeName(this,"body")||f(this).replaceWith(this.childNodes)}).end()},append:function(){return this.domManip(arguments,!0,function(a){this.nodeType===1&&this.appendChild(a)})},prepend:function(){return this.domManip(arguments,!0,function(a){this.nodeType===1&&this.insertBefore(a,this.firstChild)})},before:function(){if(this[0]&&this[0].parentNode)return this.domManip(arguments,!1,function(a){this.parentNode.insertBefore(a,this)});if(arguments.length){var a=f
.clean(arguments);a.push.apply(a,this.toArray());return this.pushStack(a,"before",arguments)}},after:function(){if(this[0]&&this[0].parentNode)return this.domManip(arguments,!1,function(a){this.parentNode.insertBefore(a,this.nextSibling)});if(arguments.length){var a=this.pushStack(this,"after",arguments);a.push.apply(a,f.clean(arguments));return a}},remove:function(a,b){for(var c=0,d;(d=this[c])!=null;c++)if(!a||f.filter(a,[d]).length)!b&&d.nodeType===1&&(f.cleanData(d.getElementsByTagName("*")),f.cleanData([d])),d.parentNode&&d.parentNode.removeChild(d);return this},empty:function(){for(var a=0,b;(b=this[a])!=null;a++){b.nodeType===1&&f.cleanData(b.getElementsByTagName("*"));while(b.firstChild)b.removeChild(b.firstChild)}return this},clone:function(a,b){a=a==null?!1:a,b=b==null?a:b;return this.map(function(){return f.clone(this,a,b)})},html:function(a){return f.access(this,function(a){var c=this[0]||{},d=0,e=this.length;if(a===b)return c.nodeType===1?c.innerHTML.replace(W,""):null;if(typeof a=="string"&&!ba.test(a)&&(f.support.leadingWhitespace||!X.test(a))&&!bg[(Z.exec(a)||["",""])[1].toLowerCase()]){a=a.replace(Y,"<$1></$2>");try{for(;d<e;d++)c=this[d]||{},c.nodeType===1&&(f.cleanData(c.getElementsByTagName("*")),c.innerHTML=a);c=0}catch(g){}}c&&this.empty().append(a)},null,a,arguments.length)},replaceWith:function(a){if(this[0]&&this[0].parentNode){if(f.isFunction(a))return this.each(function(b){var c=f(this),d=c.html();c.replaceWith(a.call(this,b,d))});typeof a!="string"&&(a=f(a).detach());return this.each(function(){var b=this.nextSibling,c=this.parentNode;f(this).remove(),b?f(b).before(a):f(c).append(a)})}return this.length?this.pushStack(f(f.isFunction(a)?a():a),"replaceWith",a):this},detach:function(a){return this.remove(a,!0)},domManip:function(a,c,d){var e,g,h,i,j=a[0],k=[];if(!f.support.checkClone&&arguments.length===3&&typeof j=="string"&&bd.test(j))return this.each(function(){f(this).domManip(a,c,d,!0)});if(f.isFunction(j))return this.each(function(e){var g=f(this);a[0]=j.call(this,e,c?g.html():b),g.domManip(a,c,d)});if(this[0]){i=j&&j.parentNode,f.support.parentNode&&i&&i.nodeType===11&&i.childNodes.length===this.length?e={fragment:i}:e=f.buildFragment(a,this,k),h=e.fragment,h.childNodes.length===1?g=h=h.firstChild:g=h.firstChild;if(g){c=c&&f.nodeName(g,"tr");for(var l=0,m=this.length,n=m-1;l<m;l++)d.call(c?bi(this[l],g):this[l],e.cacheable||m>1&&l<n?f.clone(h,!0,!0):h)}k.length&&f.each(k,function(a,b){b.src?f.ajax({type:"GET",global:!1,url:b.src,async:!1,dataType:"script"}):f.globalEval((b.text||b.textContent||b.innerHTML||"").replace(bf,"/*$0*/")),b.parentNode&&b.parentNode.removeChild(b)})}return this}}),f.buildFragment=function(a,b,d){var e,g,h,i,j=a[0];b&&b[0]&&(i=b[0].ownerDocument||b[0]),i.createDocumentFragment||(i=c),a.length===1&&typeof j=="string"&&j.length<512&&i===c&&j.charAt(0)==="<"&&!bb.test(j)&&(f.support.checkClone||!bd.test(j))&&(f.support.html5Clone||!bc.test(j))&&(g=!0,h=f.fragments[j],h&&h!==1&&(e=h)),e||(e=i.createDocumentFragment(),f.clean(a,i,e,d)),g&&(f.fragments[j]=h?e:1);return{fragment:e,cacheable:g}},f.fragments={},f.each({appendTo:"append",prependTo:"prepend",insertBefore:"before",insertAfter:"after",replaceAll:"replaceWith"},function(a,b){f.fn[a]=function(c){var d=[],e=f(c),g=this.length===1&&this[0].parentNode;if(g&&g.nodeType===11&&g.childNodes.length===1&&e.length===1){e[b](this[0]);return this}for(var h=0,i=e.length;h<i;h++){var j=(h>0?this.clone(!0):this).get();f(e[h])[b](j),d=d.concat(j)}return this.pushStack(d,a,e.selector)}}),f.extend({clone:function(a,b,c){var d,e,g,h=f.support.html5Clone||f.isXMLDoc(a)||!bc.test("<"+a.nodeName+">")?a.cloneNode(!0):bo(a);if((!f.support.noCloneEvent||!f.support.noCloneChecked)&&(a.nodeType===1||a.nodeType===11)&&!f.isXMLDoc(a)){bk(a,h),d=bl(a),e=bl(h);for(g=0;d[g];++g)e[g]&&bk(d[g],e[g])}if(b){bj(a,h);if(c){d=bl(a),e=bl(h);for(g=0;d[g];++g)bj(d[g],e[g])}}d=e=null;return h},clean:function(a,b,d,e){var g,h,i,j=[];b=b||c,typeof b.createElement=="undefined"&&(b=b.ownerDocument||b[0]&&b[0].ownerDocument||c);for(var k=0,l;(l=a[k])!=null;k++){typeof l=="number"&&(l+="");if(!l)continue;if(typeof l=="string")if(!_.test(l))l=b.createTextNode(l);else{l=l.replace(Y,"<$1></$2>");var m=(Z.exec(l)||["",""])[1].toLowerCase(),n=bg[m]||bg._default,o=n[0],p=b.createElement("div"),q=bh.childNodes,r;b===c?bh.appendChild(p):U(b).appendChild(p),p.innerHTML=n[1]+l+n[2];while(o--)p=p.lastChild;if(!f.support.tbody){var s=$.test(l),t=m==="table"&&!s?p.firstChild&&p.firstChild.childNodes:n[1]==="<table>"&&!s?p.childNodes:[];for(i=t.length-1;i>=0;--i)f.nodeName(t[i],"tbody")&&!t[i].childNodes.length&&t[i].parentNode.removeChild(t[i])}!f.support.leadingWhitespace&&X.test(l)&&p.insertBefore(b.createTextNode(X.exec(l)[0]),p.firstChild),l=p.childNodes,p&&(p.parentNode.removeChild(p),q.length>0&&(r=q[q.length-1],r&&r.parentNode&&r.parentNode.removeChild(r)))}var u;if(!f.support.appendChecked)if(l[0]&&typeof (u=l.length)=="number")for(i=0;i<u;i++)bn(l[i]);else bn(l);l.nodeType?j.push(l):j=f.merge(j,l)}if(d){g=function(a){return!a.type||be.test(a.type)};for(k=0;j[k];k++){h=j[k];if(e&&f.nodeName(h,"script")&&(!h.type||be.test(h.type)))e.push(h.parentNode?h.parentNode.removeChild(h):h);else{if(h.nodeType===1){var v=f.grep(h.getElementsByTagName("script"),g);j.splice.apply(j,[k+1,0].concat(v))}d.appendChild(h)}}}return j},cleanData:function(a){var b,c,d=f.cache,e=f.event.special,g=f.support.deleteExpando;for(var h=0,i;(i=a[h])!=null;h++){if(i.nodeName&&f.noData[i.nodeName.toLowerCase()])continue;c=i[f.expando];if(c){b=d[c];if(b&&b.events){for(var j in b.events)e[j]?f.event.remove(i,j):f.removeEvent(i,j,b.handle);b.handle&&(b.handle.elem=null)}g?delete i[f.expando]:i.removeAttribute&&i.removeAttribute(f.expando),delete d[c]}}}});var bp=/alpha\([^)]*\)/i,bq=/opacity=([^)]*)/,br=/([A-Z]|^ms)/g,bs=/^[\-+]?(?:\d*\.)?\d+$/i,bt=/^-?(?:\d*\.)?\d+(?!px)[^\d\s]+$/i,bu=/^([\-+])=([\-+.\de]+)/,bv=/^margin/,bw={position:"absolute",visibility:"hidden",display:"block"},bx=["Top","Right","Bottom","Left"],by,bz,bA;f.fn.css=function(a,c){return f.access(this,function(a,c,d){return d!==b?f.style(a,c,d):f.css(a,c)},a,c,arguments.length>1)},f.extend({cssHooks:{opacity:{get:function(a,b){if(b){var c=by(a,"opacity");return c===""?"1":c}return a.style.opacity}}},cssNumber:{fillOpacity:!0,fontWeight:!0,lineHeight:!0,opacity:!0,orphans:!0,widows:!0,zIndex:!0,zoom:!0},cssProps:{"float":f.support.cssFloat?"cssFloat":"styleFloat"},style:function(a,c,d,e){if(!!a&&a.nodeType!==3&&a.nodeType!==8&&!!a.style){var g,h,i=f.camelCase(c),j=a.style,k=f.cssHooks[i];c=f.cssProps[i]||i;if(d===b){if(k&&"get"in k&&(g=k.get(a,!1,e))!==b)return g;return j[c]}h=typeof d,h==="string"&&(g=bu.exec(d))&&(d=+(g[1]+1)*+g[2]+parseFloat(f.css(a,c)),h="number");if(d==null||h==="number"&&isNaN(d))return;h==="number"&&!f.cssNumber[i]&&(d+="px");if(!k||!("set"in k)||(d=k.set(a,d))!==b)try{j[c]=d}catch(l){}}},css:function(a,c,d){var e,g;c=f.camelCase(c),g=f.cssHooks[c],c=f.cssProps[c]||c,c==="cssFloat"&&(c="float");if(g&&"get"in g&&(e=g.get(a,!0,d))!==b)return e;if(by)return by(a,c)},swap:function(a,b,c){var d={},e,f;for(f in b)d[f]=a.style[f],a.style[f]=b[f];e=c.call(a);for(f in b)a.style[f]=d[f];return e}}),f.curCSS=f.css,c.defaultView&&c.defaultView.getComputedStyle&&(bz=function(a,b){var c,d,e,g,h=a.style;b=b.replace(br,"-$1").toLowerCase(),(d=a.ownerDocument.defaultView)&&(e=d.getComputedStyle(a,null))&&(c=e.getPropertyValue(b),c===""&&!f.contains(a.ownerDocument.documentElement,a)&&(c=f.style(a,b))),!f.support.pixelMargin&&e&&bv.test(b)&&bt.test(c)&&(g=h.width,h.width=c,c=e.width,h.width=g);return c}),c.documentElement.currentStyle&&(bA=function(a,b){var c,d,e,f=a.currentStyle&&a.currentStyle[b],g=a.style;f==null&&g&&(e=g[b])&&(f=e),bt.test(f)&&(c=g.left,d=a.runtimeStyle&&a.runtimeStyle.left,d&&(a.runtimeStyle.left=a.currentStyle.left),g.left=b==="fontSize"?"1em":f,f=g.pixelLeft+"px",g.left=c,d&&(a.runtimeStyle.left=d));return f===""?"auto":f}),by=bz||bA,f.each(["height","width"],function(a,b){f.cssHooks[b]={get:function(a,c,d){if(c)return a.offsetWidth!==0?bB(a,b,d):f.swap(a,bw,function(){return bB(a,b,d)})},set:function(a,b){return bs.test(b)?b+"px":b}}}),f.support.opacity||(f.cssHooks.opacity={get:function(a,b){return bq.test((b&&a.currentStyle?a.currentStyle.filter:a.style.filter)||"")?parseFloat(RegExp.$1)/100+"":b?"1":""},set:function(a,b){var c=a.style,d=a.currentStyle,e=f.isNumeric(b)?"alpha(opacity="+b*100+")":"",g=d&&d.filter||c.filter||"";c.zoom=1;if(b>=1&&f.trim(g.replace(bp,""))===""){c.removeAttribute("filter");if(d&&!d.filter)return}c.filter=bp.test(g)?g.replace(bp,e):g+" "+e}}),f(function(){f.support.reliableMarginRight||(f.cssHooks.marginRight={get:function(a,b){return f.swap(a,{display:"inline-block"},function(){return b?by(a,"margin-right"):a.style.marginRight})}})}),f.expr&&f.expr.filters&&(f.expr.filters.hidden=function(a){var b=a.offsetWidth,c=a.offsetHeight;return b===0&&c===0||!f.support.reliableHiddenOffsets&&(a.style&&a.style.display||f.css(a,"display"))==="none"},f.expr.filters.visible=function(a){return!f.expr.filters.hidden(a)}),f.each({margin:"",padding:"",border:"Width"},function(a,b){f.cssHooks[a+b]={expand:function(c){var d,e=typeof c=="string"?c.split(" "):[c],f={};for(d=0;d<4;d++)f[a+bx[d]+b]=e[d]||e[d-2]||e[0];return f}}});var bC=/%20/g,bD=/\[\]$/,bE=/\r?\n/g,bF=/#.*$/,bG=/^(.*?):[ \t]*([^\r\n]*)\r?$/mg,bH=/^(?:color|date|datetime|datetime-local|email|hidden|month|number|password|range|search|tel|text|time|url|week)$/i,bI=/^(?:about|app|app\-storage|.+\-extension|file|res|widget):$/,bJ=/^(?:GET|HEAD)$/,bK=/^\/\//,bL=/\?/,bM=/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,bN=/^(?:select|textarea)/i,bO=/\s+/,bP=/([?&])_=[^&]*/,bQ=/^([\w\+\.\-]+:)(?:\/\/([^\/?#:]*)(?::(\d+))?)?/,bR=f.fn.load,bS={},bT={},bU,bV,bW=["*/"]+["*"];try{bU=e.href}catch(bX){bU=c.createElement("a"),bU.href="",bU=bU.href}bV=bQ.exec(bU.toLowerCase())||[],f.fn.extend({load:function(a,c,d){if(typeof a!="string"&&bR)return bR.apply(this,arguments);if(!this.length)return this;var e=a.indexOf(" ");if(e>=0){var g=a.slice(e,a.length);a=a.slice(0,e)}var h="GET";c&&(f.isFunction(c)?(d=c,c=b):typeof c=="object"&&(c=f.param(c,f.ajaxSettings.traditional),h="POST"));var i=this;f.ajax({url:a,type:h,dataType:"html",data:c,complete:function(a,b,c){c=a.responseText,a.isResolved()&&(a.done(function(a){c=a}),i.html(g?f("<div>").append(c.replace(bM,"")).find(g):c)),d&&i.each(d,[c,b,a])}});return this},serialize:function(){return f.param(this.serializeArray())},serializeArray:function(){return this.map(function(){return this.elements?f.makeArray(this.elements):this}).filter(function(){return this.name&&!this.disabled&&(this.checked||bN.test(this.nodeName)||bH.test(this.type))}).map(function(a,b){var c=f(this).val();return c==null?null:f.isArray(c)?f.map(c,function(a,c){return{name:b.name,value:a.replace(bE,"\r\n")}}):{name:b.name,value:c.replace(bE,"\r\n")}}).get()}}),f.each("ajaxStart ajaxStop ajaxComplete ajaxError ajaxSuccess ajaxSend".split(" "),function(a,b){f.fn[b]=function(a){return this.on(b,a)}}),f.each(["get","post"],function(a,c){f[c]=function(a,d,e,g){f.isFunction(d)&&(g=g||e,e=d,d=b);return f.ajax({type:c,url:a,data:d,success:e,dataType:g})}}),f.extend({getScript:function(a,c){return f.get(a,b,c,"script")},getJSON:function(a,b,c){return f.get(a,b,c,"json")},ajaxSetup:function(a,b){b?b$(a,f.ajaxSettings):(b=a,a=f.ajaxSettings),b$(a,b);return a},ajaxSettings:{url:bU,isLocal:bI.test(bV[1]),global:!0,type:"GET",contentType:"application/x-www-form-urlencoded; charset=UTF-8",processData:!0,async:!0,accepts:{xml:"application/xml, text/xml",html:"text/html",text:"text/plain",json:"application/json, text/javascript","*":bW},contents:{xml:/xml/,html:/html/,json:/json/},responseFields:{xml:"responseXML",text:"responseText"},converters:{"* text":a.String,"text html":!0,"text json":f.parseJSON,"text xml":f.parseXML},flatOptions:{context:!0,url:!0}},ajaxPrefilter:bY(bS),ajaxTransport:bY(bT),ajax:function(a,c){function w(a,c,l,m){if(s!==2){s=2,q&&clearTimeout(q),p=b,n=m||"",v.readyState=a>0?4:0;var o,r,u,w=c,x=l?ca(d,v,l):b,y,z;if(a>=200&&a<300||a===304){if(d.ifModified){if(y=v.getResponseHeader("Last-Modified"))f.lastModified[k]=y;if(z=v.getResponseHeader("Etag"))f.etag[k]=z}if(a===304)w="notmodified",o=!0;else try{r=cb(d,x),w="success",o=!0}catch(A){w="parsererror",u=A}}else{u=w;if(!w||a)w="error",a<0&&(a=0)}v.status=a,v.statusText=""+(c||w),o?h.resolveWith(e,[r,w,v]):h.rejectWith(e,[v,w,u]),v.statusCode(j),j=b,t&&g.trigger("ajax"+(o?"Success":"Error"),[v,d,o?r:u]),i.fireWith(e,[v,w]),t&&(g.trigger("ajaxComplete",[v,d]),--f.active||f.event.trigger("ajaxStop"))}}typeof a=="object"&&(c=a,a=b),c=c||{};var d=f.ajaxSetup({},c),e=d.context||d,g=e!==d&&(e.nodeType||e instanceof f)?f(e):f.event,h=f.Deferred(),i=f.Callbacks("once memory"),j=d.statusCode||{},k,l={},m={},n,o,p,q,r,s=0,t,u,v={readyState:0,setRequestHeader:function(a,b){if(!s){var c=a.toLowerCase();a=m[c]=m[c]||a,l[a]=b}return this},getAllResponseHeaders:function(){return s===2?n:null},getResponseHeader:function(a){var c;if(s===2){if(!o){o={};while(c=bG.exec(n))o[c[1].toLowerCase()]=c[2]}c=o[a.toLowerCase()]}return c===b?null:c},overrideMimeType:function(a){s||(d.mimeType=a);return this},abort:function(a){a=a||"abort",p&&p.abort(a),w(0,a);return this}};h.promise(v),v.success=v.done,v.error=v.fail,v.complete=i.add,v.statusCode=function(a){if(a){var b;if(s<2)for(b in a)j[b]=[j[b],a[b]];else b=a[v.status],v.then(b,b)}return this},d.url=((a||d.url)+"").replace(bF,"").replace(bK,bV[1]+"//"),d.dataTypes=f.trim(d.dataType||"*").toLowerCase().split(bO),d.crossDomain==null&&(r=bQ.exec(d.url.toLowerCase()),d.crossDomain=!(!r||r[1]==bV[1]&&r[2]==bV[2]&&(r[3]||(r[1]==="http:"?80:443))==(bV[3]||(bV[1]==="http:"?80:443)))),d.data&&d.processData&&typeof d.data!="string"&&(d.data=f.param(d.data,d.traditional)),bZ(bS,d,c,v);if(s===2)return!1;t=d.global,d.type=d.type.toUpperCase(),d.hasContent=!bJ.test(d.type),t&&f.active++===0&&f.event.trigger("ajaxStart");if(!d.hasContent){d.data&&(d.url+=(bL.test(d.url)?"&":"?")+d.data,delete d.data),k=d.url;if(d.cache===!1){var x=f.now(),y=d.url.replace(bP,"$1_="+x);d.url=y+(y===d.url?(bL.test(d.url)?"&":"?")+"_="+x:"")}}(d.data&&d.hasContent&&d.contentType!==!1||c.contentType)&&v.setRequestHeader("Content-Type",d.contentType),d.ifModified&&(k=k||d.url,f.lastModified[k]&&v.setRequestHeader("If-Modified-Since",f.lastModified[k]),f.etag[k]&&v.setRequestHeader("If-None-Match",f.etag[k])),v.setRequestHeader("Accept",d.dataTypes[0]&&d.accepts[d.dataTypes[0]]?d.accepts[d.dataTypes[0]]+(d.dataTypes[0]!=="*"?", "+bW+"; q=0.01":""):d.accepts["*"]);for(u in d.headers)v.setRequestHeader(u,d.headers[u]);if(d.beforeSend&&(d.beforeSend.call(e,v,d)===!1||s===2)){v.abort();return!1}for(u in{success:1,error:1,complete:1})v[u](d[u]);p=bZ(bT,d,c,v);if(!p)w(-1,"No Transport");else{v.readyState=1,t&&g.trigger("ajaxSend",[v,d]),d.async&&d.timeout>0&&(q=setTimeout(function(){v.abort("timeout")},d.timeout));try{s=1,p.send(l,w)}catch(z){if(s<2)w(-1,z);else throw z}}return v},param:function(a,c){var d=[],e=function(a,b){b=f.isFunction(b)?b():b,d[d.length]=encodeURIComponent(a)+"="+encodeURIComponent(b)};c===b&&(c=f.ajaxSettings.traditional);if(f.isArray(a)||a.jquery&&!f.isPlainObject(a))f.each(a,function(){e(this.name,this.value)});else for(var g in a)b_(g,a[g],c,e);return d.join("&").replace(bC,"+")}}),f.extend({active:0,lastModified:{},etag:{}});var cc=f.now(),cd=/(\=)\?(&|$)|\?\?/i;f.ajaxSetup({jsonp:"callback",jsonpCallback:function(){return f.expando+"_"+cc++}}),f.ajaxPrefilter("json jsonp",function(b,c,d){var e=typeof b.data=="string"&&/^application\/x\-www\-form\-urlencoded/.test(b.contentType);if(b.dataTypes[0]==="jsonp"||b.jsonp!==!1&&(cd.test(b.url)||e&&cd.test(b.data))){var g,h=b.jsonpCallback=f.isFunction(b.jsonpCallback)?b.jsonpCallback():b.jsonpCallback,i=a[h],j=b.url,k=b.data,l="$1"+h+"$2";b.jsonp!==!1&&(j=j.replace(cd,l),b.url===j&&(e&&(k=k.replace(cd,l)),b.data===k&&(j+=(/\?/.test(j)?"&":"?")+b.jsonp+"="+h))),b.url=j,b.data=k,a[h]=function(a){g=[a]},d.always(function(){a[h]=i,g&&f.isFunction(i)&&a[h](g[0])}),b.converters["script json"]=function(){g||f.error(h+" was not called");return g[0]},b.dataTypes[0]="json";return"script"}}),f.ajaxSetup({accepts:{script:"text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"},contents:{script:/javascript|ecmascript/},converters:{"text script":function(a){f.globalEval(a);return a}}}),f.ajaxPrefilter("script",function(a){a.cache===b&&(a.cache=!1),a.crossDomain&&(a.type="GET",a.global=!1)}),f.ajaxTransport("script",function(a){if(a.crossDomain){var d,e=c.head||c.getElementsByTagName("head")[0]||c.documentElement;return{send:function(f,g){d=c.createElement("script"),d.async="async",a.scriptCharset&&(d.charset=a.scriptCharset),d.src=a.url,d.onload=d.onreadystatechange=function(a,c){if(c||!d.readyState||/loaded|complete/.test(d.readyState))d.onload=d.onreadystatechange=null,e&&d.parentNode&&e.removeChild(d),d=b,c||g(200,"success")},e.insertBefore(d,e.firstChild)},abort:function(){d&&d.onload(0,1)}}}});var ce=a.ActiveXObject?function(){for(var a in cg)cg[a](0,1)}:!1,cf=0,cg;f.ajaxSettings.xhr=a.ActiveXObject?function(){return!this.isLocal&&ch()||ci()}:ch,function(a){f.extend(f.support,{ajax:!!a,cors:!!a&&"withCredentials"in a})}(f.ajaxSettings.xhr()),f.support.ajax&&f.ajaxTransport(function(c){if(!c.crossDomain||f.support.cors){var d;return{send:function(e,g){var h=c.xhr(),i,j;c.username?h.open(c.type,c.url,c.async,c.username,c.password):h.open(c.type,c.url,c.async);if(c.xhrFields)for(j in c.xhrFields)h[j]=c.xhrFields[j];c.mimeType&&h.overrideMimeType&&h.overrideMimeType(c.mimeType),!c.crossDomain&&!e["X-Requested-With"]&&(e["X-Requested-With"]="XMLHttpRequest");try{for(j in e)h.setRequestHeader(j,e[j])}catch(k){}h.send(c.hasContent&&c.data||null),d=function(a,e){var j,k,l,m,n;try{if(d&&(e||h.readyState===4)){d=b,i&&(h.onreadystatechange=f.noop,ce&&delete cg[i]);if(e)h.readyState!==4&&h.abort();else{j=h.status,l=h.getAllResponseHeaders(),m={},n=h.responseXML,n&&n.documentElement&&(m.xml=n);try{m.text=h.responseText}catch(a){}try{k=h.statusText}catch(o){k=""}!j&&c.isLocal&&!c.crossDomain?j=m.text?200:404:j===1223&&(j=204)}}}catch(p){e||g(-1,p)}m&&g(j,k,m,l)},!c.async||h.readyState===4?d():(i=++cf,ce&&(cg||(cg={},f(a).unload(ce)),cg[i]=d),h.onreadystatechange=d)},abort:function(){d&&d(0,1)}}}});var cj={},ck,cl,cm=/^(?:toggle|show|hide)$/,cn=/^([+\-]=)?([\d+.\-]+)([a-z%]*)$/i,co,cp=[["height","marginTop","marginBottom","paddingTop","paddingBottom"],["width","marginLeft","marginRight","paddingLeft","paddingRight"],["opacity"]],cq;f.fn.extend({show:function(a,b,c){var d,e;if(a||a===0)return this.animate(ct("show",3),a,b,c);for(var g=0,h=this.length;g<h;g++)d=this[g],d.style&&(e=d.style.display,!f._data(d,"olddisplay")&&e==="none"&&(e=d.style.display=""),(e===""&&f.css(d,"display")==="none"||!f.contains(d.ownerDocument.documentElement,d))&&f._data(d,"olddisplay",cu(d.nodeName)));for(g=0;g<h;g++){d=this[g];if(d.style){e=d.style.display;if(e===""||e==="none")d.style.display=f._data(d,"olddisplay")||""}}return this},hide:function(a,b,c){if(a||a===0)return this.animate(ct("hide",3),a,b,c);var d,e,g=0,h=this.length;for(;g<h;g++)d=this[g],d.style&&(e=f.css(d,"display"),e!=="none"&&!f._data(d,"olddisplay")&&f._data(d,"olddisplay",e));for(g=0;g<h;g++)this[g].style&&(this[g].style.display="none");return this},_toggle:f.fn.toggle,toggle:function(a,b,c){var d=typeof a=="boolean";f.isFunction(a)&&f.isFunction(b)?this._toggle.apply(this,arguments):a==null||d?this.each(function(){var b=d?a:f(this).is(":hidden");f(this)[b?"show":"hide"]()}):this.animate(ct("toggle",3),a,b,c);return this},fadeTo:function(a,b,c,d){return this.filter(":hidden").css("opacity",0).show().end().animate({opacity:b},a,c,d)},animate:function(a,b,c,d){function g(){e.queue===!1&&f._mark(this);var b=f.extend({},e),c=this.nodeType===1,d=c&&f(this).is(":hidden"),g,h,i,j,k,l,m,n,o,p,q;b.animatedProperties={};for(i in a){g=f.camelCase(i),i!==g&&(a[g]=a[i],delete a[i]);if((k=f.cssHooks[g])&&"expand"in k){l=k.expand(a[g]),delete a[g];for(i in l)i in a||(a[i]=l[i])}}for(g in a){h=a[g],f.isArray(h)?(b.animatedProperties[g]=h[1],h=a[g]=h[0]):b.animatedProperties[g]=b.specialEasing&&b.specialEasing[g]||b.easing||"swing";if(h==="hide"&&d||h==="show"&&!d)return b.complete.call(this);c&&(g==="height"||g==="width")&&(b.overflow=[this.style.overflow,this.style.overflowX,this.style.overflowY],f.css(this,"display")==="inline"&&f.css(this,"float")==="none"&&(!f.support.inlineBlockNeedsLayout||cu(this.nodeName)==="inline"?this.style.display="inline-block":this.style.zoom=1))}b.overflow!=null&&(this.style.overflow="hidden");for(i in a)j=new f.fx(this,b,i),h=a[i],cm.test(h)?(q=f._data(this,"toggle"+i)||(h==="toggle"?d?"show":"hide":0),q?(f._data(this,"toggle"+i,q==="show"?"hide":"show"),j[q]()):j[h]()):(m=cn.exec(h),n=j.cur(),m?(o=parseFloat(m[2]),p=m[3]||(f.cssNumber[i]?"":"px"),p!=="px"&&(f.style(this,i,(o||1)+p),n=(o||1)/j.cur()*n,f.style(this,i,n+p)),m[1]&&(o=(m[1]==="-="?-1:1)*o+n),j.custom(n,o,p)):j.custom(n,h,""));return!0}var e=f.speed(b,c,d);if(f.isEmptyObject(a))return this.each(e.complete,[!1]);a=f.extend({},a);return e.queue===!1?this.each(g):this.queue(e.queue,g)},stop:function(a,c,d){typeof a!="string"&&(d=c,c=a,a=b),c&&a!==!1&&this.queue(a||"fx",[]);return this.each(function(){function h(a,b,c){var e=b[c];f.removeData(a,c,!0),e.stop(d)}var b,c=!1,e=f.timers,g=f._data(this);d||f._unmark(!0,this);if(a==null)for(b in g)g[b]&&g[b].stop&&b.indexOf(".run")===b.length-4&&h(this,g,b);else g[b=a+".run"]&&g[b].stop&&h(this,g,b);for(b=e.length;b--;)e[b].elem===this&&(a==null||e[b].queue===a)&&(d?e[b](!0):e[b].saveState(),c=!0,e.splice(b,1));(!d||!c)&&f.dequeue(this,a)})}}),f.each({slideDown:ct("show",1),slideUp:ct("hide",1),slideToggle:ct("toggle",1),fadeIn:{opacity:"show"},fadeOut:{opacity:"hide"},fadeToggle:{opacity:"toggle"}},function(a,b){f.fn[a]=function(a,c,d){return this.animate(b,a,c,d)}}),f.extend({speed:function(a,b,c){var d=a&&typeof a=="object"?f.extend({},a):{complete:c||!c&&b||f.isFunction(a)&&a,duration:a,easing:c&&b||b&&!f.isFunction(b)&&b};d.duration=f.fx.off?0:typeof d.duration=="number"?d.duration:d.duration in f.fx.speeds?f.fx.speeds[d.duration]:f.fx.speeds._default;if(d.queue==null||d.queue===!0)d.queue="fx";d.old=d.complete,d.complete=function(a){f.isFunction(d.old)&&d.old.call(this),d.queue?f.dequeue(this,d.queue):a!==!1&&f._unmark(this)};return d},easing:{linear:function(a){return a},swing:function(a){return-Math.cos(a*Math.PI)/2+.5}},timers:[],fx:function(a,b,c){this.options=b,this.elem=a,this.prop=c,b.orig=b.orig||{}}}),f.fx.prototype={update:function(){this.options.step&&this.options.step.call(this.elem,this.now,this),(f.fx.step[this.prop]||f.fx.step._default)(this)},cur:function(){if(this.elem[this.prop]!=null&&(!this.elem.style||this.elem.style[this.prop]==null))return this.elem[this.prop];var a,b=f.css(this.elem,this.prop);return isNaN(a=parseFloat(b))?!b||b==="auto"?0:b:a},custom:function(a,c,d){function h(a){return e.step(a)}var e=this,g=f.fx;this.startTime=cq||cr(),this.end=c,this.now=this.start=a,this.pos=this.state=0,this.unit=d||this.unit||(f.cssNumber[this.prop]?"":"px"),h.queue=this.options.queue,h.elem=this.elem,h.saveState=function(){f._data(e.elem,"fxshow"+e.prop)===b&&(e.options.hide?f._data(e.elem,"fxshow"+e.prop,e.start):e.options.show&&f._data(e.elem,"fxshow"+e.prop,e.end))},h()&&f.timers.push(h)&&!co&&(co=setInterval(g.tick,g.interval))},show:function(){var a=f._data(this.elem,"fxshow"+this.prop);this.options.orig[this.prop]=a||f.style(this.elem,this.prop),this.options.show=!0,a!==b?this.custom(this.cur(),a):this.custom(this.prop==="width"||this.prop==="height"?1:0,this.cur()),f(this.elem).show()},hide:function(){this.options.orig[this.prop]=f._data(this.elem,"fxshow"+this.prop)||f.style(this.elem,this.prop),this.options.hide=!0,this.custom(this.cur(),0)},step:function(a){var b,c,d,e=cq||cr(),g=!0,h=this.elem,i=this.options;if(a||e>=i.duration+this.startTime){this.now=this.end,this.pos=this.state=1,this.update(),i.animatedProperties[this.prop]=!0;for(b in i.animatedProperties)i.animatedProperties[b]!==!0&&(g=!1);if(g){i.overflow!=null&&!f.support.shrinkWrapBlocks&&f.each(["","X","Y"],function(a,b){h.style["overflow"+b]=i.overflow[a]}),i.hide&&f(h).hide();if(i.hide||i.show)for(b in i.animatedProperties)f.style(h,b,i.orig[b]),f.removeData(h,"fxshow"+b,!0),f.removeData(h,"toggle"+b,!0);d=i.complete,d&&(i.complete=!1,d.call(h))}return!1}i.duration==Infinity?this.now=e:(c=e-this.startTime,this.state=c/i.duration,this.pos=f.easing[i.animatedProperties[this.prop]](this.state,c,0,1,i.duration),this.now=this.start+(this.end-this.start)*this.pos),this.update();return!0}},f.extend(f.fx,{tick:function(){var a,b=f.timers,c=0;for(;c<b.length;c++)a=b[c],!a()&&b[c]===a&&b.splice(c--,1);b.length||f.fx.stop()},interval:13,stop:function(){clearInterval(co),co=null},speeds:{slow:600,fast:200,_default:400},step:{opacity:function(a){f.style(a.elem,"opacity",a.now)},_default:function(a){a.elem.style&&a.elem.style[a.prop]!=null?a.elem.style[a.prop]=a.now+a.unit:a.elem[a.prop]=a.now}}}),f.each(cp.concat.apply([],cp),function(a,b){b.indexOf("margin")&&(f.fx.step[b]=function(a){f.style(a.elem,b,Math.max(0,a.now)+a.unit)})}),f.expr&&f.expr.filters&&(f.expr.filters.animated=function(a){return f.grep(f.timers,function(b){return a===b.elem}).length});var cv,cw=/^t(?:able|d|h)$/i,cx=/^(?:body|html)$/i;"getBoundingClientRect"in c.documentElement?cv=function(a,b,c,d){try{d=a.getBoundingClientRect()}catch(e){}if(!d||!f.contains(c,a))return d?{top:d.top,left:d.left}:{top:0,left:0};var g=b.body,h=cy(b),i=c.clientTop||g.clientTop||0,j=c.clientLeft||g.clientLeft||0,k=h.pageYOffset||f.support.boxModel&&c.scrollTop||g.scrollTop,l=h.pageXOffset||f.support.boxModel&&c.scrollLeft||g.scrollLeft,m=d.top+k-i,n=d.left+l-j;return{top:m,left:n}}:cv=function(a,b,c){var d,e=a.offsetParent,g=a,h=b.body,i=b.defaultView,j=i?i.getComputedStyle(a,null):a.currentStyle,k=a.offsetTop,l=a.offsetLeft;while((a=a.parentNode)&&a!==h&&a!==c){if(f.support.fixedPosition&&j.position==="fixed")break;d=i?i.getComputedStyle(a,null):a.currentStyle,k-=a.scrollTop,l-=a.scrollLeft,a===e&&(k+=a.offsetTop,l+=a.offsetLeft,f.support.doesNotAddBorder&&(!f.support.doesAddBorderForTableAndCells||!cw.test(a.nodeName))&&(k+=parseFloat(d.borderTopWidth)||0,l+=parseFloat(d.borderLeftWidth)||0),g=e,e=a.offsetParent),f.support.subtractsBorderForOverflowNotVisible&&d.overflow!=="visible"&&(k+=parseFloat(d.borderTopWidth)||0,l+=parseFloat(d.borderLeftWidth)||0),j=d}if(j.position==="relative"||j.position==="static")k+=h.offsetTop,l+=h.offsetLeft;f.support.fixedPosition&&j.position==="fixed"&&(k+=Math.max(c.scrollTop,h.scrollTop),l+=Math.max(c.scrollLeft,h.scrollLeft));return{top:k,left:l}},f.fn.offset=function(a){if(arguments.length)return a===b?this:this.each(function(b){f.offset.setOffset(this,a,b)});var c=this[0],d=c&&c.ownerDocument;if(!d)return null;if(c===d.body)return f.offset.bodyOffset(c);return cv(c,d,d.documentElement)},f.offset={bodyOffset:function(a){var b=a.offsetTop,c=a.offsetLeft;f.support.doesNotIncludeMarginInBodyOffset&&(b+=parseFloat(f.css(a,"marginTop"))||0,c+=parseFloat(f.css(a,"marginLeft"))||0);return{top:b,left:c}},setOffset:function(a,b,c){var d=f.css(a,"position");d==="static"&&(a.style.position="relative");var e=f(a),g=e.offset(),h=f.css(a,"top"),i=f.css(a,"left"),j=(d==="absolute"||d==="fixed")&&f.inArray("auto",[h,i])>-1,k={},l={},m,n;j?(l=e.position(),m=l.top,n=l.left):(m=parseFloat(h)||0,n=parseFloat(i)||0),f.isFunction(b)&&(b=b.call(a,c,g)),b.top!=null&&(k.top=b.top-g.top+m),b.left!=null&&(k.left=b.left-g.left+n),"using"in b?b.using.call(a,k):e.css(k)}},f.fn.extend({position:function(){if(!this[0])return null;var a=this[0],b=this.offsetParent(),c=this.offset(),d=cx.test(b[0].nodeName)?{top:0,left:0}:b.offset();c.top-=parseFloat(f.css(a,"marginTop"))||0,c.left-=parseFloat(f.css(a,"marginLeft"))||0,d.top+=parseFloat(f.css(b[0],"borderTopWidth"))||0,d.left+=parseFloat(f.css(b[0],"borderLeftWidth"))||0;return{top:c.top-d.top,left:c.left-d.left}},offsetParent:function(){return this.map(function(){var a=this.offsetParent||c.body;while(a&&!cx.test(a.nodeName)&&f.css(a,"position")==="static")a=a.offsetParent;return a})}}),f.each({scrollLeft:"pageXOffset",scrollTop:"pageYOffset"},function(a,c){var d=/Y/.test(c);f.fn[a]=function(e){return f.access(this,function(a,e,g){var h=cy(a);if(g===b)return h?c in h?h[c]:f.support.boxModel&&h.document.documentElement[e]||h.document.body[e]:a[e];h?h.scrollTo(d?f(h).scrollLeft():g,d?g:f(h).scrollTop()):a[e]=g},a,e,arguments.length,null)}}),f.each({Height:"height",Width:"width"},function(a,c){var d="client"+a,e="scroll"+a,g="offset"+a;f.fn["inner"+a]=function(){var a=this[0];return a?a.style?parseFloat(f.css(a,c,"padding")):this[c]():null},f.fn["outer"+a]=function(a){var b=this[0];return b?b.style?parseFloat(f.css(b,c,a?"margin":"border")):this[c]():null},f.fn[c]=function(a){return f.access(this,function(a,c,h){var i,j,k,l;if(f.isWindow(a)){i=a.document,j=i.documentElement[d];return f.support.boxModel&&j||i.body&&i.body[d]||j}if(a.nodeType===9){i=a.documentElement;if(i[d]>=i[e])return i[d];return Math.max(a.body[e],i[e],a.body[g],i[g])}if(h===b){k=f.css(a,c),l=parseFloat(k);return f.isNumeric(l)?l:k}f(a).css(c,h)},c,a,arguments.length,null)}}),a.jQuery=a.$=f,typeof define=="function"&&define.amd&&define.amd.jQuery&&define("jquery",[],function(){return f})})(window);
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// karyoscape.js
//

function Karyoscape(browser, dsn)
{
    this.browser = browser; // for tooltips.
    this.dsn = dsn;
    this.svg = makeElementNS(NS_SVG, 'g');
    this.width = 250;
}

Karyoscape.prototype.update = function(chr, start, end) {
    this.start = start;
    this.end = end;
    if (!this.chr || chr != this.chr) {
	this.chr = chr;
	removeChildren(this.svg);

	var kscape = this;
	this.dsn.features(
	    new DASSegment(chr),
	    {type: 'karyotype'},
	    function(karyos, err, segmentMap) {
                if (segmentMap && segmentMap[chr] && segmentMap[chr].max) {
                    kscape.chrLen = segmentMap[chr].max;
                } else {
                    kscape.chrLen = null;
                }
		kscape.karyos = karyos || [];
		kscape.redraw();
	    }
	);
    } else {
	this.setThumb();
    }
}

var karyo_palette = {
    gneg: 'white',
    gpos25: 'rgb(200,200,200)',
    gpos33: 'rgb(180,180,180)',
    gpos50: 'rgb(128,128,128)',
    gpos66: 'rgb(100,100,100)',
    gpos75: 'rgb(64,64,64)',
    gpos100: 'rgb(0,0,0)',
    gpos: 'rgb(0,0,0)',
    gvar: 'rgb(100,100,100)',
    acen: 'rgb(100,100,100)',
    stalk: 'rgb(100,100,100)'
};

Karyoscape.prototype.redraw = function() {
    removeChildren(this.svg);
    this.karyos = this.karyos.sort(function(k1, k2) {
        return (k1.min|0) - (k2.min|0);
    });
    if (this.karyos.length > 0) {
        if (!this.chrLen) {
	    this.chrLen = this.karyos[this.karyos.length - 1].max;
        }
    } else {
        if (!this.chrLen) {
            alert('Warning: insufficient data to set up spatial navigator');
            this.chrLen = 200000000;
        } 
        this.karyos.push({
            min: 1,
            max: this.chrLen,
            label: 'gneg'
        });
    }
    var bandspans = null;
    for (var i = 0; i < this.karyos.length; ++i) {
	var k = this.karyos[i];
	var bmin = ((1.0 * k.min) / this.chrLen) * this.width;
	var bmax = ((1.0 * k.max) / this.chrLen) * this.width;
	var col = karyo_palette[k.label];
	if (!col) {
	    // alert("don't understand " + k.label);
	} else {
            if (bmax > bmin) {
	        var band = makeElementNS(NS_SVG, 'rect', null, {
		    x: bmin,
		    y: (k.label == 'stalk' || k.label == 'acen' ? 5 : 0),
		    width: (bmax - bmin),
		    height: (k.label == 'stalk' || k.label == 'acen'? 5 : 15),
		    stroke: 'none',
		    fill: col
	        });
	        if (k.label.substring(0, 1) == 'g') {
		    var br = new Range(k.min, k.max);
		    if (bandspans == null) {
		        bandspans = br;
		    } else {
		        bandspans = union(bandspans, br);
		    }
	        }
	        this.browser.makeTooltip(band, k.id);
	        this.svg.appendChild(band);
            }
	}
    }

    if (bandspans) {
	var r = bandspans.ranges();

        var pathopsT = 'M 0 10 L 0 0';
        var pathopsB = 'M 0 5 L 0 15';
        
        var curx = 0;
        for (var ri = 0; ri < r.length; ++ri) {
            var rr = r[ri];
	    var bmin = ((1.0 * rr.min()) / this.chrLen) * this.width;
	    var bmax = ((1.0 * rr.max()) / this.chrLen) * this.width;
            if ((bmin - curx > 0.75)) {
                pathopsT += ' M ' + bmin + ' 0';
                pathopsB += ' M ' + bmin + ' 15';
            }
            pathopsT +=  ' L ' + bmax + ' 0';
            pathopsB +=  ' L ' + bmax + ' 15';
            curx = bmax;
        }
        if ((this.width - curx) > 0.75) {
            pathopsT += ' M ' + this.width + ' 0';
            pathopsB += ' M ' + this.width + ' 15';
        } else {
            pathopsT += ' L ' + this.width + ' 0';
            pathopsB += ' L ' + this.width + ' 15';
        }
        pathopsT +=  ' L ' + this.width + ' 10';
        pathopsB +=  ' L ' + this.width + ' 5';
        this.svg.appendChild(makeElementNS(NS_SVG, 'path', null, {
            d: pathopsT + ' ' + pathopsB,
            stroke: 'black',
            strokeWidth: 2,
            fill: 'none'
        }));
    }

    this.thumb = makeElementNS(NS_SVG, 'rect', null, {
	x: 50, y: -5, width: 8, height: 25,
	fill: 'blue', fillOpacity: 0.5, stroke: 'none'
    });
    this.svg.appendChild(this.thumb);
    this.setThumb();

    var thisKaryo = this;
    var sliderDeltaX;

    var moveHandler = function(ev) {
	ev.stopPropagation(); ev.preventDefault();
	var sliderX = Math.max(-4, Math.min(ev.clientX + sliderDeltaX, thisKaryo.width - 4));
	thisKaryo.thumb.setAttribute('x', sliderX);
//	if (thisSlider.onchange) {
//	    thisSlider.onchange(value, false);
//	}
    }
    var upHandler = function(ev) {
    	ev.stopPropagation(); ev.preventDefault();
	if (thisKaryo.onchange) {
	    thisKaryo.onchange((1.0 * ((thisKaryo.thumb.getAttribute('x')|0) + 4)) / thisKaryo.width, true);
	}
	document.removeEventListener('mousemove', moveHandler, true);
	document.removeEventListener('mouseup', upHandler, true);
    }

    this.thumb.addEventListener('mousedown', function(ev) {
	ev.stopPropagation(); ev.preventDefault();
	sliderDeltaX = thisKaryo.thumb.getAttribute('x') - ev.clientX;
	document.addEventListener('mousemove', moveHandler, true);
	document.addEventListener('mouseup', upHandler, true);
    }, false);
}

Karyoscape.prototype.setThumb = function() {
    var pos = ((this.start|0) + (this.end|0)) / 2
    var gpos = ((1.0 * pos)/this.chrLen) * this.width;
    if (this.thumb) {
        this.thumb.setAttribute('x', gpos - 4);
    }
}
	    

/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2011
//
// kspace.js: Manage a block of Known Space
//


function FetchPool() {
    this.reqs = [];
}

FetchPool.prototype.addRequest = function(xhr) {
    this.reqs.push(xhr);
}

FetchPool.prototype.abortAll = function() {
    for (var i = 0; i < this.reqs.length; ++i) {
	this.reqs[i].abort();
    }
}

function KSCacheBaton(chr, min, max, scale, features, status) {
    this.chr = chr;
    this.min = min;
    this.max = max;
    this.scale = scale;
    this.features = features || [];
    this.status = status;
}

KSCacheBaton.prototype.toString = function() {
    return this.chr + ":" + this.min + ".." + this.max + ";scale=" + this.scale;
}

function KnownSpace(tierMap, chr, min, max, scale, seqSource) {
    this.tierMap = tierMap;
    this.chr = chr;
    this.min = min;
    this.max = max;
    this.scale = scale;
    this.seqSource = seqSource || new DummySequenceSource();

    this.featureCache = {};
}

KnownSpace.prototype.bestCacheOverlapping = function(chr, min, max) {
    var baton = this.featureCache[this.tierMap[0]];
    if (baton) {
	return baton;
    } else {
	return null;
    }
}

KnownSpace.prototype.viewFeatures = function(chr, min, max, scale) {
    // dlog('viewFeatures(' + chr + ', ' + min + ', ' + max + ', ' + scale +')');
    if (scale != scale) {
	throw "viewFeatures called with silly scale";
    }

    if (chr != this.chr) {
	throw "Can't extend Known Space to a new chromosome";
    }
    this.min = min;
    this.max = max;
    this.scale = scale;

    if (this.pool) {
	this.pool.abortAll();
    }
    this.pool = new FetchPool();
    this.awaitedSeq = new Awaited();
    this.seqWasFetched = false;
    
    this.startFetchesForTiers(this.tierMap);
}
    
function filterFeatures(features, min, max) {
    var ff = [];
    featuresByGroup = {};

    for (var fi = 0; fi < features.length; ++fi) {
	var f = features[fi];
        if (!f.min || !f.max) {
            ff.push(f);
        } else if (f.groups && f.groups.length > 0) {
            pusho(featuresByGroup, f.groups[0].id, f);
        } else if (f.min <= max && f.max >= min) {
	    ff.push(f);
	}
    }

    for (var gid in featuresByGroup) {
        var gf = featuresByGroup[gid];
        var gmin = 100000000000, gmax = -100000000000;
        for (var fi = 0; fi < gf.length; ++fi) {
            var f = gf[fi];
            gmin = Math.min(gmin, f.min);
            gmax = Math.max(gmax, f.max);
        }
        if (gmin <= max || gmax >= min) {
            for (var fi = 0; fi < gf.length; ++fi) {
                ff.push(gf[fi]);
            }
        }
    }

    return ff;
}

KnownSpace.prototype.invalidate = function(tier) {
    this.featureCache[tier] = null;
    this.startFetchesForTiers([tier]);
}

KnownSpace.prototype.startFetchesForTiers = function(tiers) {
    var thisB = this;

    var awaitedSeq = this.awaitedSeq;
    var needSeq = false;

    for (var t = 0; t < tiers.length; ++t) {
	if (this.startFetchesFor(tiers[t], awaitedSeq)) {
            needSeq = true;
        }
    }

    if (needSeq && !this.seqWasFetched) {
        this.seqWasFetched = true;
        // dlog('needSeq ' + this.chr + ':' + this.min + '..' + this.max);
        var smin = this.min, smax = this.max;

        if (this.cs) {
            if (this.cs.start <= smin && this.cs.end >= smax) {
                var cachedSeq;
                if (this.cs.start == smin && this.cs.end == smax) {
                    cachedSeq = this.cs;
                } else {
                    cachedSeq = new DASSequence(this.cs.name, smin, smax, this.cs.alphabet, 
                                                this.cs.seq.substring(smin - this.cs.start, smax + 1 - this.cs.start));
                }
                return awaitedSeq.provide(cachedSeq);
            }
        }
        
        this.seqSource.fetch(this.chr, smin, smax, this.pool, function(err, seq) {
            if (seq) {
                if (!thisB.cs || (smin <= thisB.cs.start && smax >= thisB.cs.end) || 
                    (smin >= thisB.cs.end) || (smax <= thisB.cs.start) || 
                    ((smax - smin) > (thisB.cs.end - thisB.cs.start))) 
                {
                    thisB.cs = seq;
                }
                awaitedSeq.provide(seq);
            } else {
                dlog('Noseq: ' + miniJSONify(err));
            }
        });
    } 
}

KnownSpace.prototype.startFetchesFor = function(tier, awaitedSeq) {
    var thisB = this;

    var source = tier.getSource() || new DummyFeatureSource();
    var needsSeq = tier.needsSequence(this.scale);
    var baton = thisB.featureCache[tier];
    var wantedTypes = tier.getDesiredTypes(this.scale);
    if (wantedTypes === undefined) {
//         dlog('skipping because wantedTypes is undef');
        return false;
    }
    if (baton) {
// 	dlog('considering cached features: ' + baton);
    }
    if (baton && baton.chr === this.chr && baton.min <= this.min && baton.max >= this.max) {
	var cachedFeatures = baton.features;
	if (baton.min < this.min || baton.max > this.max) {
	    cachedFeatures = filterFeatures(cachedFeatures, this.min, this.max);
	}
        
        // dlog('cached scale=' + baton.scale + '; wanted scale=' + thisB.scale);
//	if ((baton.scale < (thisB.scale/2) && cachedFeatures.length > 200) || (wantedTypes && wantedTypes.length == 1 && wantedTypes.indexOf('density') >= 0) ) {
//	    cachedFeatures = downsample(cachedFeatures, thisB.scale);
//	}
        // dlog('Provisioning ' + tier.toString() + ' with ' + cachedFeatures.length + ' features from cache');
//	tier.viewFeatures(baton.chr, Math.max(baton.min, this.min), Math.min(baton.max, this.max), baton.scale, cachedFeatures);   // FIXME change scale if downsampling

        thisB.provision(tier, baton.chr, Math.max(baton.min, this.min), Math.min(baton.max, this.max), baton.scale, wantedTypes, cachedFeatures, baton.status, needsSeq ? awaitedSeq : null);

	var availableScales = source.getScales();
	if (baton.scale <= this.scale || !availableScales) {
//	    dlog('used cached features');
	    return needsSeq;
	} else {
//	    dlog('used cached features (temporarily)');
	}
    }

    source.fetch(this.chr, this.min, this.max, this.scale, wantedTypes, this.pool, function(status, features, scale) {
	if (!baton || (thisB.min < baton.min) || (thisB.max > baton.max)) {         // FIXME should be merging in some cases?
	    thisB.featureCache[tier] = new KSCacheBaton(thisB.chr, thisB.min, thisB.max, scale, features, status);
	}

	//if ((scale < (thisB.scale/2) && features.length > 200) || (wantedTypes && wantedTypes.length == 1 && wantedTypes.indexOf('density') >= 0) ) {
	//    features = downsample(features, thisB.scale);
	//}
        // dlog('Provisioning ' + tier.toString() + ' with fresh features');
	//tier.viewFeatures(thisB.chr, thisB.min, thisB.max, this.scale, features);
        thisB.provision(tier, thisB.chr, thisB.min, thisB.max, thisB.scale, wantedTypes, features, status, needsSeq ? awaitedSeq : null);
    });
    return needsSeq;
}

KnownSpace.prototype.provision = function(tier, chr, min, max, actualScale, wantedTypes, features, status, awaitedSeq) {
    if (status) {
        tier.updateStatus(status);
    } else {
        if ((actualScale < (this.scale/2) && features.length > 200) || 
            (BWGFeatureSource.prototype.isPrototypeOf(tier.getSource()) && wantedTypes && wantedTypes.length == 1 && wantedTypes.indexOf('density') >= 0)|| 
            (BAMFeatureSource.prototype.isPrototypeOf(tier.getSource()) && wantedTypes && wantedTypes.length == 1 && wantedTypes.indexOf('density') >= 0)) 
        {
	    features = downsample(features, this.scale);
        }

        if (awaitedSeq) {
            awaitedSeq.await(function(seq) {
                tier.viewFeatures(chr, min, max, actualScale, features, seq);
            });
        } else {
            tier.viewFeatures(chr, min, max, actualScale, features);
        }
    }
}


function DASFeatureSource(dasSource) {
    this.dasSource = dasSource;
}

DASFeatureSource.prototype.fetch = function(chr, min, max, scale, types, pool, callback) {
    if (types && types.length == 0) {
        callback(null, [], scale);
        return;
    }

    if (!this.dasSource.uri) {
	return;
    }

    var tryMaxBins = (this.dasSource.maxbins !== false);
    var fops = {
        type: types
    };
    if (tryMaxBins) {
        fops.maxbins = 1 + (((max - min) / scale) | 0);
    }
    
    this.dasSource.features(
	new DASSegment(chr, min, max),
	fops,
	function(features, status) {
            var retScale = scale;
            if (!tryMaxBins) {
                retScale = 0.1;
            }
	    callback(status, features, retScale);
	}
    );
}

function DASSequenceSource(dasSource) {
    this.dasSource = dasSource;
}


DASSequenceSource.prototype.fetch = function(chr, min, max, pool, callback) {
    this.dasSource.sequence(
        new DASSegment(chr, min, max),
        function(seqs) {
            if (seqs.length == 1) {
                return callback(null, seqs[0]);
            } else {
                return callback("Didn't get sequence");
            }
        }
    );
}

function TwoBitSequenceSource(source) {
    var thisB = this;
    this.source = source;
    this.twoBit = new Awaited();
    makeTwoBit(new URLFetchable(source.twoBitURI), function(tb, error) {
        if (error) {
            dlog(error);
        } else {
            thisB.twoBit.provide(tb);
        }
    });
}

TwoBitSequenceSource.prototype.fetch = function(chr, min, max, pool, callback) {
        this.twoBit.await(function(tb) {
            tb.fetch(chr, min, max,
                     function(seq, err) {
                         if (err) {
                             return callback(err, null);
                         } else {
		             var sequence = new DASSequence(chr, min, max, 'DNA', seq);
                             return callback(null, sequence);
                         }
                     })
        });
}


DASFeatureSource.prototype.getScales = function() {
    return [];
}

var bwg_preflights = {};

function BWGFeatureSource(bwgSource, opts) {
    var thisB = this;
    this.bwgSource = bwgSource;
    this.opts = opts || {};
    
    thisB.bwgHolder = new Awaited();

    if (this.opts.preflight) {
        var pfs = bwg_preflights[this.opts.preflight];
        if (!pfs) {
            pfs = new Awaited();
            bwg_preflights[this.opts.preflight] = pfs;

            var req = new XMLHttpRequest();
            req.onreadystatechange = function() {
                if (req.readyState == 4) {
                    if (req.status == 200) {
                        pfs.provide('success');
                    } else {
                        pfs.provide('failure');
                    }
                }
            };
            // req.setRequestHeader('cache-control', 'no-cache');    /* Doesn't work, not an allowed request header in CORS */
            req.open('get', this.opts.preflight + '?' + hex_sha1('salt' + Date.now()), true);    // Instead, ensure we always preflight a unique URI.
            if (this.opts.credentials) {
                req.withCredentials = true;
            }
            req.send('');
        }
        pfs.await(function(status) {
            if (status === 'success') {
                thisB.init();
            }
        });
    } else {
        thisB.init();
    }
}

function BAMFeatureSource(bamSource, opts) {
    var thisB = this;
    this.bamSource = bamSource;
    this.opts = opts || {};
    this.bamHolder = new Awaited();
    var bamF, baiF;
    if (bamSource.bamBlob) {
        bamF = new BlobFetchable(bamSource.bamBlob);
        baiF = new BlobFetchable(bamSource.baiBlob);
    } else {
        bamF = new URLFetchable(bamSource.bamURI);
        baiF = new URLFetchable(bamSource.baiURI || (bamSource.bamURI + '.bai'));
    }
    makeBam(bamF, baiF, function(bam) {
        thisB.bamHolder.provide(bam);
    });
}

BAMFeatureSource.prototype.fetch = function(chr, min, max, scale, types, pool, callback) {
    var thisB = this;
    this.bamHolder.await(function(bam) {
        bam.fetch(chr, min, max, function(bamRecords, error) {
            if (error) {
                callback(error, null, null);
            } else {
                var features = [];
                for (var ri = 0; ri < bamRecords.length; ++ri) {
                    var r = bamRecords[ri];
                    var f = new DASFeature();
                    f.min = r.pos + 1;
                    f.max = r.pos + r.seq.length;
                    f.segment = r.segment;
                    f.type = 'bam';
                    f.id = r.readName;
                    f.notes = ['Sequence=' + r.seq, 'CIGAR=' + r.cigar, 'MQ=' + r.mq];
                    f.seq = r.seq;
                    features.push(f);
                }
                callback(null, features, 1000000000);
            }
        });
    });
}

BAMFeatureSource.prototype.getScales = function() {
    return 1000000000;
}
    


BWGFeatureSource.prototype.init = function() {
    var thisB = this;
    var make, arg;
    if (this.bwgSource.bwgURI) {
        make = makeBwgFromURL;
        arg = this.bwgSource.bwgURI;
    } else {
        make = makeBwgFromFile;
        arg = this.bwgSource.bwgBlob;
    }

    make(arg, function(bwg) {
	thisB.bwgHolder.provide(bwg);
    }, this.opts.credentials);
}

BWGFeatureSource.prototype.fetch = function(chr, min, max, scale, types, pool, callback) {
    var thisB = this;
    this.bwgHolder.await(function(bwg) {
        if (bwg == null) {
            return callback("Can't access binary file", null, null);
        }

        // dlog('bwg: ' + bwg.name + '; want scale: ' + scale);
        var data;
        // dlog(miniJSONify(types));
        var wantDensity = !types || types.length == 0 || arrayIndexOf(types, 'density') >= 0;
/*        if (wantDensity) {
            dlog('want density; scale=' + scale);
        } */
        if (thisB.opts.clientBin) {
            wantDensity = false;
        }
        if (bwg.type == 'bigwig' || wantDensity || (typeof thisB.opts.forceReduction !== 'undefined')) {
            var zoom = -1;
            for (var z = 0; z < bwg.zoomLevels.length; ++z) {
                if (bwg.zoomLevels[z].reduction <= scale) {
                    zoom = z;
                } else {
                    break;
                }
            }
            if (typeof thisB.opts.forceReduction !== 'undefined') {
                zoom = thisB.opts.forceReduction;
            }
           // dlog('selected zoom: ' + zoom);
            if (zoom < 0) {
                data = bwg.getUnzoomedView();
            } else {
                data = bwg.getZoomedView(zoom);
            }
        } else {
            data = bwg.getUnzoomedView();
        }
	data.readWigData(chr, min, max, function(features) {
	    var fs = 1000000000;
	    // if (bwg.type === 'bigwig') {
		var is = (max - min) / features.length / 2;
		if (is < fs) {
		    fs = is;
		}
	    // }
	    callback(null, features, fs);
	});
    });
}

BWGFeatureSource.prototype.getScales = function() {
    var bwg = this.bwgHolder.res;
    if (bwg /* && bwg.type == 'bigwig' */) {
	var scales = [1];  // Can we be smarter about inferring baseline scale?
        for (var z = 0; z < bwg.zoomLevels.length; ++z) {
            scales.push(bwg.zoomLevels[z].reduction);
        }
        return scales;
    } else {
	return null;
    }
}




function MappedFeatureSource(source, mapping) {
    this.source = source;
    this.mapping = mapping;
}

MappedFeatureSource.prototype.getScales = function() {
    return this.source.getScales();
}

MappedFeatureSource.prototype.fetch = function(chr, min, max, scale, types, pool, callback) {
    var thisB = this;

    this.mapping.sourceBlocksForRange(chr, min, max, function(mseg) {
        if (mseg.length == 0) {
            callback("No mapping available for this regions", [], scale);
        } else {
	    var seg = mseg[0];
	    thisB.source.fetch(seg.name, seg.start, seg.end, scale, types, pool, function(status, features, fscale) {
		var mappedFeatures = [];
		if (features) {
		    for (var fi = 0; fi < features.length; ++fi) {
                        var f = features[fi];
			var sn = f.segment;
			if (sn.indexOf('chr') == 0) {
			    sn = sn.substr(3);
			}
                        var mmin = thisB.mapping.mapPoint(sn, f.min);
                        var mmax = thisB.mapping.mapPoint(sn, f.max);
                        if (!mmin || !mmax || mmin.seq != mmax.seq || mmin.seq != chr) {
                            // Discard feature.
                            // dlog('discarding ' + miniJSONify(f));
                            if (f.parts && f.parts.length > 0) {    // FIXME: Ugly hack to make ASTD source map properly.
                                 mappedFeatures.push(f);
                            }
                        } else {
                            f.segment = mmin.seq;
                            f.min = mmin.pos;
                            f.max = mmax.pos;
                            if (f.min > f.max) {
                                var tmp = f.max;
                                f.max = f.min;
                                f.min = tmp;
                            }
                            if (mmin.flipped) {
                                if (f.orientation == '-') {
                                    f.orientation = '+';
                                } else if (f.orientation == '+') {
                                    f.orientation = '-';
                                }
                            }
                            mappedFeatures.push(f);
                        }
                    }
		}

		callback(status, mappedFeatures, fscale);
	    });
	}
    });
}

function DummyFeatureSource() {
}

DummyFeatureSource.prototype.getScales = function() {
    return null;
}

DummyFeatureSource.prototype.fetch = function(chr, min, max, scale, types, pool, cnt) {
    return cnt(null, [], 1000000000);
}

function DummySequenceSource() {
}

DummySequenceSource.prototype.fetch = function(chr, min, max, pool, cnt) {
    return cnt(null, null);
}
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// quant-config.js: configuration of quantitatively-scaled tiers
//

var VALID_BOUND_RE = new RegExp('^-?[0-9]+(\\.[0-9]+)?$');

Browser.prototype.makeQuantConfigButton = function(quantTools, tier, ypos) {
    var thisB = this;
    quantTools.addEventListener('mousedown', function(ev) {
	ev.stopPropagation(); ev.preventDefault();
	thisB.removeAllPopups();

	var form = makeElement('table');
	var minInput = makeElement('input', '', {value: tier.min});
        form.appendChild(makeElement('tr', [makeElement('td', 'Min:'), makeElement('td', minInput)]));
	var maxInput = makeElement('input', '', {value: tier.max});
        form.appendChild(makeElement('tr', [makeElement('td', 'Max:'), makeElement('td', maxInput)]));
        
	var updateButton = makeElement('div', 'Update');
        updateButton.style.backgroundColor = 'rgb(230,230,250)';
        updateButton.style.borderStyle = 'solid';
        updateButton.style.borderColor = 'blue';
        updateButton.style.borderWidth = '3px';
        updateButton.style.padding = '2px';
        updateButton.style.margin = '10px';
        updateButton.style.width = '150px';

	updateButton.addEventListener('mousedown', function(ev) {
	    ev.stopPropagation(); ev.preventDefault();

            if (!VALID_BOUND_RE.test(minInput.value)) {
                alert("Don't understand " + minInput.value);
                return;
            }
            if (!VALID_BOUND_RE.test(maxInput.value)) {
                alert("Don't understand " + maxInput.value);
                return;
            }

	    tier.dasSource.forceMin = minInput.value;
	    tier.dasSource.forceMax = maxInput.value;
	    thisB.removeAllPopups();
            tier.draw();
            thisB.storeStatus();          // write updated limits to storage.
	}, false);

        thisB.popit(ev, 'Configure: ' + tier.dasSource.name, [form, updateButton]);
    }, false);
}
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// sample.js: downsampling of quantitative features
//

var __DS_SCALES = [1, 2, 5];

function ds_scale(n) {
    return __DS_SCALES[n % __DS_SCALES.length] * Math.pow(10, (n / __DS_SCALES.length)|0);
}


function DSBin(scale, min, max) {
    this.scale = scale;
    this.tot = 0;
    this.cnt = 0;
    this.hasScore = false;
    this.min = min; this.max = max;
    this.lap = 0;
    this.covered = null;
}

DSBin.prototype.score = function() {
    if (this.cnt == 0) {
	return 0;
    } else if (this.hasScore) {
	return this.tot / this.cnt;
    } else {
        return this.lap / coverage(this.covered);
    }
}

DSBin.prototype.feature = function(f) {
    if (f.score) {
        this.tot += f.score;
        this.hasScore = true
    }
    var fMin = f.min|0;
    var fMax = f.max|0;
    var lMin = Math.max(this.min, fMin);
    var lMax = Math.min(this.max, fMax);
    // dlog('f.min=' + fMin + '; f.max=' + fMax + '; lMin=' + lMin + '; lMax=' + lMax + '; lap=' + (1.0 * (lMax - lMin + 1))/(fMax - fMin + 1));
    this.lap += (1.0 * (lMax - lMin + 1));
    ++this.cnt;
    var newRange = new Range(lMin, lMax);
    if (this.covered) {
        this.covered = union(this.covered, newRange);
    } else {
        this.covered = newRange;
    }
}

function downsample(features, targetRez) {
    var beforeDS = Date.now();

    var sn = 0;
    while (ds_scale(sn + 1) < targetRez) {
	++sn;
    }
    var scale = ds_scale(sn);

    var binTots = [];
    var maxBin = -10000000000;
    var minBin = 10000000000;
    for (var fi = 0; fi < features.length; ++fi) {
	var f = features[fi];
        if (f.groups && f.groups.length > 0) {
            // Don't downsample complex features (?)
            return features;
        }
//	if (f.score) {
	    var minLap = (f.min / scale)|0;
	    var maxLap = (f.max / scale)|0;
	    maxBin = Math.max(maxBin, maxLap);
	    minBin = Math.min(minBin, minLap);
	    for (var b = minLap; b <= maxLap; ++b) {
		var bm = binTots[b];
		if (!bm) {
		    bm = new DSBin(scale, b * scale, (b + 1) * scale - 1);
		    binTots[b] = bm;
		}
		bm.feature(f);
	    }
//	}
    }

    var sampledFeatures = [];
    for (var b = minBin; b <= maxBin; ++b) {
	var bm = binTots[b];
	if (bm) {
	    var f = new DASFeature();
            f.segment = features[0].segment;
            f.min = (b * scale) + 1;
            f.max = (b + 1) * scale;
            f.score = bm.score();
            f.type = 'density';
	    sampledFeatures.push(f);
	}
    }

    var afterDS = Date.now();
    // dlog('downsampled ' + features.length + ' -> ' + sampledFeatures.length + ' in ' + (afterDS - beforeDS) + 'ms');
    return sampledFeatures;
}
// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// sequence-tier.js: renderers for sequence-related data
//

var MIN_TILE = 75;
var rulerTileColors = ['black', 'white'];
var baseColors = {A: 'green', C: 'blue', G: 'black', T: 'red'};
var steps = [1,2,5];

function tileSizeForScale(scale, min)
{
    if (!min) {
	min = MIN_TILE;
    }

    function ts(p) {
	return steps[p % steps.length] * Math.pow(10, (p / steps.length)|0);
    }
    var pow = steps.length;
    while (scale * ts(pow) < min) {
	++pow;
    }
    return ts(pow);
}

function drawGuidelines(tier, featureGroupElement)
{
    if (tier.browser.guidelineStyle != 'background') {
	return;
    }

    var tile = tileSizeForScale(tier.browser.scale, teir.browser.guidelineSpacing);
    var pos = Math.max(0, ((tier.browser.knownStart / tile)|0) * tile);

    var seqTierMax = knownEnd;
    if (tier.browser.currentSeqMax > 0 && tier.browser.currentSeqMax < tier.browser.knownEnd) {
	seqTierMax = tier.browser.currentSeqMax;
    }

    for (var glpos = pos; glpos <= seqTierMax; glpos += tile) {
	var guideline = document.createElementNS(NS_SVG, 'line');
	guideline.setAttribute('x1', (glpos - origin) * scale);
	guideline.setAttribute('y1', 0);
	guideline.setAttribute('x2', (glpos - origin) * scale);
	guideline.setAttribute('y2', 1000);
	guideline.setAttribute('stroke', 'black');
	guideline.setAttribute('stroke-opacity', 0.2);
	guideline.setAttribute('stroke-width', 1);
	featureGroupElement.appendChild(guideline);
    }
}


function drawSeqTier(tier, seq)
{
    var scale = tier.browser.scale, knownStart = tier.knownStart, knownEnd = tier.knownEnd, origin = tier.browser.origin, currentSeqMax = tier.browser.currentSeqMax;
    if (!scale) {
	return;
    }

    var featureGroupElement = tier.viewport;
    while (featureGroupElement.childNodes.length > 0) {
	featureGroupElement.removeChild(featureGroupElement.firstChild);
    }
    featureGroupElement.appendChild(tier.background);
    drawGuidelines(tier, featureGroupElement);
    
    var tile = tileSizeForScale(scale);
    var pos = Math.max(0, ((knownStart / tile)|0) * tile);

    var seqTierMax = knownEnd;
    if (currentSeqMax > 0 && currentSeqMax < knownEnd) {
	seqTierMax = currentSeqMax;
    }
	
    var height = 35;
    var drawCheckers = false;
    if (seq && seq.seq) {
	for (var i = seq.start; i <= seq.end; ++i) {
	    var base = seq.seq.substr(i - seq.start, 1).toUpperCase();
	    var color = baseColors[base];
	    if (!color) {
	        color = 'gray';
	    }
	    
	    if (scale >= 8) {
                var labelText = document.createElementNS(NS_SVG, "text");
                labelText.setAttribute("x", ((i - origin) * scale));
                labelText.setAttribute("y",  12);
                labelText.setAttribute("stroke-width", "0");
                labelText.setAttribute("fill", color);
                labelText.setAttribute("class", "label-text");
                labelText.appendChild(document.createTextNode(base));
                featureGroupElement.appendChild(labelText);
	    } else {
                var rect = document.createElementNS(NS_SVG, "rect");
                rect.setAttribute('x', ((i - origin) * scale));
                rect.setAttribute('y', 5);
                rect.setAttribute('height', 10);
                rect.setAttribute('width', scale);
                rect.setAttribute('fill', color);
                rect.setAttribute('stroke', 'none');
                featureGroupElement.appendChild(rect);
	    }
        }
    } else {
	drawCheckers = true;
    }

    while (pos <= seqTierMax) {
	if (drawCheckers) {
            var rect = document.createElementNS(NS_SVG, "rect");
            rect.setAttribute('x', (pos - origin) * scale);
            rect.setAttribute('y', 8);
            rect.setAttribute('height', 3);
            var rwid = Math.min(tile, seqTierMax - pos) * scale;
            rect.setAttribute('width', rwid);
            rect.setAttribute('fill', rulerTileColors[(pos / tile) % 2]);
            rect.setAttribute('stroke-width', 1);
            featureGroupElement.appendChild(rect);
	}
        
        if ((pos / tile) % 2 == 0) {
	    var fudge = 0;
	    if (!drawCheckers) {
		featureGroupElement.appendChild(
		    makeElementNS(NS_SVG, 'line', null, {
			x1: ((pos - origin) * scale),
			y1: 15,
			x2: ((pos - origin) * scale),
			y2: 35,
			stroke: 'rgb(80, 90, 150)',
			strokeWidth: 1
		    }));
		fudge += 3;
	    }

            var labelText = document.createElementNS(NS_SVG, "text");
            labelText.setAttribute("x", ((pos - origin) * scale) + fudge);
            labelText.setAttribute("y",  30);
            labelText.setAttribute("stroke-width", "0");
            labelText.setAttribute("fill", "black");
            labelText.setAttribute("class", "label-text");
            labelText.appendChild(document.createTextNode('' + pos));
            featureGroupElement.appendChild(labelText);
        }
	     
	pos += tile;
    }

    tier.layoutHeight = height;
    tier.background.setAttribute("height", height);
    tier.scale = 1;
    tier.browser.arrangeTiers();
}
/*
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-1, as defined
 * in FIPS 180-1
 * Version 2.2 Copyright Paul Johnston 2000 - 2009.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for details.
 */

/*
 * Configurable variables. You may need to tweak these to be compatible with
 * the server-side, but the defaults work in most cases.
 */
var hexcase = 0;  /* hex output format. 0 - lowercase; 1 - uppercase        */
var b64pad  = ""; /* base-64 pad character. "=" for strict RFC compliance   */

/*
 * These are the functions you'll usually want to call
 * They take string arguments and return either hex or base-64 encoded strings
 */
function hex_sha1(s)    { return rstr2hex(rstr_sha1(str2rstr_utf8(s))); }
function b64_sha1(s)    { return rstr2b64(rstr_sha1(str2rstr_utf8(s))); }
function any_sha1(s, e) { return rstr2any(rstr_sha1(str2rstr_utf8(s)), e); }
function hex_hmac_sha1(k, d)
  { return rstr2hex(rstr_hmac_sha1(str2rstr_utf8(k), str2rstr_utf8(d))); }
function b64_hmac_sha1(k, d)
  { return rstr2b64(rstr_hmac_sha1(str2rstr_utf8(k), str2rstr_utf8(d))); }
function any_hmac_sha1(k, d, e)
  { return rstr2any(rstr_hmac_sha1(str2rstr_utf8(k), str2rstr_utf8(d)), e); }

/*
 * Perform a simple self-test to see if the VM is working
 */
function sha1_vm_test()
{
  return hex_sha1("abc").toLowerCase() == "a9993e364706816aba3e25717850c26c9cd0d89d";
}

/*
 * Calculate the SHA1 of a raw string
 */
function rstr_sha1(s)
{
  return binb2rstr(binb_sha1(rstr2binb(s), s.length * 8));
}

/*
 * Calculate the HMAC-SHA1 of a key and some data (raw strings)
 */
function rstr_hmac_sha1(key, data)
{
  var bkey = rstr2binb(key);
  if(bkey.length > 16) bkey = binb_sha1(bkey, key.length * 8);

  var ipad = Array(16), opad = Array(16);
  for(var i = 0; i < 16; i++)
  {
    ipad[i] = bkey[i] ^ 0x36363636;
    opad[i] = bkey[i] ^ 0x5C5C5C5C;
  }

  var hash = binb_sha1(ipad.concat(rstr2binb(data)), 512 + data.length * 8);
  return binb2rstr(binb_sha1(opad.concat(hash), 512 + 160));
}

/*
 * Convert a raw string to a hex string
 */
function rstr2hex(input)
{
  try { hexcase } catch(e) { hexcase=0; }
  var hex_tab = hexcase ? "0123456789ABCDEF" : "0123456789abcdef";
  var output = "";
  var x;
  for(var i = 0; i < input.length; i++)
  {
    x = input.charCodeAt(i);
    output += hex_tab.charAt((x >>> 4) & 0x0F)
           +  hex_tab.charAt( x        & 0x0F);
  }
  return output;
}

/*
 * Convert a raw string to a base-64 string
 */
function rstr2b64(input)
{
  try { b64pad } catch(e) { b64pad=''; }
  var tab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var output = "";
  var len = input.length;
  for(var i = 0; i < len; i += 3)
  {
    var triplet = (input.charCodeAt(i) << 16)
                | (i + 1 < len ? input.charCodeAt(i+1) << 8 : 0)
                | (i + 2 < len ? input.charCodeAt(i+2)      : 0);
    for(var j = 0; j < 4; j++)
    {
      if(i * 8 + j * 6 > input.length * 8) output += b64pad;
      else output += tab.charAt((triplet >>> 6*(3-j)) & 0x3F);
    }
  }
  return output;
}

/*
 * Convert a raw string to an arbitrary string encoding
 */
function rstr2any(input, encoding)
{
  var divisor = encoding.length;
  var remainders = Array();
  var i, q, x, quotient;

  /* Convert to an array of 16-bit big-endian values, forming the dividend */
  var dividend = Array(Math.ceil(input.length / 2));
  for(i = 0; i < dividend.length; i++)
  {
    dividend[i] = (input.charCodeAt(i * 2) << 8) | input.charCodeAt(i * 2 + 1);
  }

  /*
   * Repeatedly perform a long division. The binary array forms the dividend,
   * the length of the encoding is the divisor. Once computed, the quotient
   * forms the dividend for the next step. We stop when the dividend is zero.
   * All remainders are stored for later use.
   */
  while(dividend.length > 0)
  {
    quotient = Array();
    x = 0;
    for(i = 0; i < dividend.length; i++)
    {
      x = (x << 16) + dividend[i];
      q = Math.floor(x / divisor);
      x -= q * divisor;
      if(quotient.length > 0 || q > 0)
        quotient[quotient.length] = q;
    }
    remainders[remainders.length] = x;
    dividend = quotient;
  }

  /* Convert the remainders to the output string */
  var output = "";
  for(i = remainders.length - 1; i >= 0; i--)
    output += encoding.charAt(remainders[i]);

  /* Append leading zero equivalents */
  var full_length = Math.ceil(input.length * 8 /
                                    (Math.log(encoding.length) / Math.log(2)))
  for(i = output.length; i < full_length; i++)
    output = encoding[0] + output;

  return output;
}

/*
 * Encode a string as utf-8.
 * For efficiency, this assumes the input is valid utf-16.
 */
function str2rstr_utf8(input)
{
  var output = "";
  var i = -1;
  var x, y;

  while(++i < input.length)
  {
    /* Decode utf-16 surrogate pairs */
    x = input.charCodeAt(i);
    y = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
    if(0xD800 <= x && x <= 0xDBFF && 0xDC00 <= y && y <= 0xDFFF)
    {
      x = 0x10000 + ((x & 0x03FF) << 10) + (y & 0x03FF);
      i++;
    }

    /* Encode output as utf-8 */
    if(x <= 0x7F)
      output += String.fromCharCode(x);
    else if(x <= 0x7FF)
      output += String.fromCharCode(0xC0 | ((x >>> 6 ) & 0x1F),
                                    0x80 | ( x         & 0x3F));
    else if(x <= 0xFFFF)
      output += String.fromCharCode(0xE0 | ((x >>> 12) & 0x0F),
                                    0x80 | ((x >>> 6 ) & 0x3F),
                                    0x80 | ( x         & 0x3F));
    else if(x <= 0x1FFFFF)
      output += String.fromCharCode(0xF0 | ((x >>> 18) & 0x07),
                                    0x80 | ((x >>> 12) & 0x3F),
                                    0x80 | ((x >>> 6 ) & 0x3F),
                                    0x80 | ( x         & 0x3F));
  }
  return output;
}

/*
 * Encode a string as utf-16
 */
function str2rstr_utf16le(input)
{
  var output = "";
  for(var i = 0; i < input.length; i++)
    output += String.fromCharCode( input.charCodeAt(i)        & 0xFF,
                                  (input.charCodeAt(i) >>> 8) & 0xFF);
  return output;
}

function str2rstr_utf16be(input)
{
  var output = "";
  for(var i = 0; i < input.length; i++)
    output += String.fromCharCode((input.charCodeAt(i) >>> 8) & 0xFF,
                                   input.charCodeAt(i)        & 0xFF);
  return output;
}

/*
 * Convert a raw string to an array of big-endian words
 * Characters >255 have their high-byte silently ignored.
 */
function rstr2binb(input)
{
  var output = Array(input.length >> 2);
  for(var i = 0; i < output.length; i++)
    output[i] = 0;
  for(var i = 0; i < input.length * 8; i += 8)
    output[i>>5] |= (input.charCodeAt(i / 8) & 0xFF) << (24 - i % 32);
  return output;
}

/*
 * Convert an array of big-endian words to a string
 */
function binb2rstr(input)
{
  var output = "";
  for(var i = 0; i < input.length * 32; i += 8)
    output += String.fromCharCode((input[i>>5] >>> (24 - i % 32)) & 0xFF);
  return output;
}

/*
 * Calculate the SHA-1 of an array of big-endian words, and a bit length
 */
function binb_sha1(x, len)
{
  /* append padding */
  x[len >> 5] |= 0x80 << (24 - len % 32);
  x[((len + 64 >> 9) << 4) + 15] = len;

  var w = Array(80);
  var a =  1732584193;
  var b = -271733879;
  var c = -1732584194;
  var d =  271733878;
  var e = -1009589776;

  for(var i = 0; i < x.length; i += 16)
  {
    var olda = a;
    var oldb = b;
    var oldc = c;
    var oldd = d;
    var olde = e;

    for(var j = 0; j < 80; j++)
    {
      if(j < 16) w[j] = x[i + j];
      else w[j] = bit_rol(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16], 1);
      var t = safe_add(safe_add(bit_rol(a, 5), sha1_ft(j, b, c, d)),
                       safe_add(safe_add(e, w[j]), sha1_kt(j)));
      e = d;
      d = c;
      c = bit_rol(b, 30);
      b = a;
      a = t;
    }

    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
    e = safe_add(e, olde);
  }
  return Array(a, b, c, d, e);

}

/*
 * Perform the appropriate triplet combination function for the current
 * iteration
 */
function sha1_ft(t, b, c, d)
{
  if(t < 20) return (b & c) | ((~b) & d);
  if(t < 40) return b ^ c ^ d;
  if(t < 60) return (b & c) | (b & d) | (c & d);
  return b ^ c ^ d;
}

/*
 * Determine the appropriate additive constant for the current iteration
 */
function sha1_kt(t)
{
  return (t < 20) ?  1518500249 : (t < 40) ?  1859775393 :
         (t < 60) ? -1894007588 : -899497514;
}

/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */
function safe_add(x, y)
{
  var lsw = (x & 0xFFFF) + (y & 0xFFFF);
  var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xFFFF);
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
function bit_rol(num, cnt)
{
  return (num << cnt) | (num >>> (32 - cnt));
}
// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// slider.js: SVG+DOM slider control
//

function DSlider(width, opts) {
    if (!opts) {
	opts = {};
    }
    this.width = width;
    this.opts = opts;

    // privates

    var value = 0;
    var thisSlider = this;
    var sliderDeltaX;

    // Create SVG

    this.svg = document.createElementNS(NS_SVG, 'g');
    this.track = document.createElementNS(NS_SVG, 'path');
    this.track.setAttribute('fill', 'grey');
    this.track.setAttribute('stroke', 'grey');
    this.track.setAttribute('stroke-width', '1');
    this.track.setAttribute('d', 'M 0 35' +
			         ' L ' + width + ' 35' +
			         ' L ' + width + ' 15' +
			         ' L 0 32 Z');
    this.svg.appendChild(this.track);

    this.handle = document.createElementNS(NS_SVG, 'rect');
    this.handle.setAttribute('x', -4);
    this.handle.setAttribute('y', 10);
    this.handle.setAttribute('width', 8);
    this.handle.setAttribute('height', 30);
    this.handle.setAttribute('stroke', 'none');
    this.handle.setAttribute('fill', 'blue');
    this.handle.setAttribute('fill-opacity', 0.5);
    this.svg.appendChild(this.handle);


    this.getValue = function() {
	return value;
    }

    this.setValue = function(v) {
	if (v < 0) {
	    v = 0;
	} else if (v > this.width) {
	    v = this.width;
	} 
	value = v;
	this.handle.setAttribute('x', value - 4);
    }

    this.setColor = function(c) {
	this.handle.setAttribute('fill', c);
    }

    this.onchange = null;

    var moveHandler = function(ev) {
	ev.stopPropagation(); ev.preventDefault();
	var sliderX = Math.max(-4, Math.min(ev.clientX + sliderDeltaX, width - 4));
	thisSlider.handle.setAttribute('x', sliderX);
	value = sliderX + 4;
	if (thisSlider.onchange) {
	    thisSlider.onchange(value, false);
	}
    }
    var upHandler = function(ev) {
	ev.stopPropagation(); ev.preventDefault();
	if (thisSlider.onchange) {
	    thisSlider.onchange(value, true);
	}
	document.removeEventListener('mousemove', moveHandler, true);
	document.removeEventListener('mouseup', upHandler, true);
    }

    this.handle.addEventListener('mousedown', function(ev) {
	ev.stopPropagation(); ev.preventDefault();
	sliderDeltaX = thisSlider.handle.getAttribute('x') - ev.clientX;
	document.addEventListener('mousemove', moveHandler, true);
	document.addEventListener('mouseup', upHandler, true);
    }, false);
}/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// spans.js: JavaScript Intset/Location port.
//

function Range(min, max)
{
    this._min = min|0;
    this._max = max|0;
}

Range.prototype.min = function() {
    return this._min;
}

Range.prototype.max = function() {
    return this._max;
}

Range.prototype.contains = function(pos) {
    return pos >= this._min && pos <= this._max;
}

Range.prototype.isContiguous = function() {
    return true;
}

Range.prototype.ranges = function() {
    return [this];
}

Range.prototype.toString = function() {
    return '[' + this._min + '-' + this._max + ']';
}

function _Compound(ranges) {
    this._ranges = ranges;
    // assert sorted?
}

_Compound.prototype.min = function() {
    return this._ranges[0].min();
}

_Compound.prototype.max = function() {
    return this._ranges[this._ranges.length - 1].max();
}

_Compound.prototype.contains = function(pos) {
    // FIXME implement bsearch if we use this much.
    for (var s = 0; s < this._ranges.length; ++s) {
	if (this._ranges[s].contains(pos)) {
	    return true;
	}
    }
    return false;
}

_Compound.prototype.isContiguous = function() {
    return this._ranges.length > 1;
}

_Compound.prototype.ranges = function() {
    return this._ranges;
}

_Compound.prototype.toString = function() {
    var s = '';
    for (var r = 0; r < this._ranges.length; ++r) {
	if (r>0) {
	    s = s + ',';
	}
	s = s + this._ranges[r].toString();
    }
    return s;
}

function union(s0, s1) {
    var ranges = s0.ranges().concat(s1.ranges()).sort(rangeOrder);
    var oranges = [];
    var current = ranges[0];

    for (var i = 1; i < ranges.length; ++i) {
	var nxt = ranges[i];
	if (nxt.min() > (current.max() + 1)) {
	    oranges.push(current);
	    current = nxt;
	} else {
	    if (nxt.max() > current.max()) {
		current = new Range(current.min(), nxt.max());
	    }
	}
    }
    oranges.push(current);

    if (oranges.length == 1) {
	return oranges[0];
    } else {
	return new _Compound(oranges);
    }
}

function intersection(s0, s1) {
    var r0 = s0.ranges();
    var r1 = s1.ranges();
    var l0 = r0.length, l1 = r1.length;
    var i0 = 0, i1 = 0;
    var or = [];

    while (i0 < l0 && i1 < l1) {
        var s0 = r0[i0], s1 = r1[i1];
        var lapMin = Math.max(s0.min(), s1.min());
        var lapMax = Math.min(s0.max(), s1.max());
        if (lapMax >= lapMin) {
            or.push(new Range(lapMin, lapMax));
        }
        if (s0.max() > s1.max()) {
            ++i1;
        } else {
            ++i0;
        }
    }
    
    if (or.length == 0) {
        return null; // FIXME
    } else if (or.length == 1) {
        return or[0];
    } else {
        return new _Compound(or);
    }
}

function coverage(s) {
    var tot = 0;
    var rl = s.ranges();
    for (var ri = 0; ri < rl.length; ++ri) {
        var r = rl[ri];
        tot += (r.max() - r.min() + 1);
    }
    return tot;
}



function rangeOrder(a, b)
{
    if (a.min() < b.min()) {
        return -1;
    } else if (a.min() > b.min()) {
        return 1;
    } else if (a.max() < b.max()) {
        return -1;
    } else if (b.max() > a.max()) {
        return 1;
    } else {
        return 0;
    }
}
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// tier.js: (try) to encapsulate the functionality of a browser tier.
//

var __tier_idSeed = 0;

function DasTier(browser, source, viewport, background)
{
    var thisTier = this;

    this.id = 'tier' + (++__tier_idSeed);
    this.browser = browser;
    this.dasSource = new DASSource(source);
    this.viewport = viewport;
    this.background = background;
    this.req = null;
    this.layoutHeight = 25;
    this.bumped = true; 
    if (this.dasSource.collapseSuperGroups) {
        this.bumped = false;
    }
    this.y = 0;
    this.layoutWasDone = false;

    var fs, ss;
    if (this.dasSource.bwgURI || this.dasSource.bwgBlob) {
        fs = new BWGFeatureSource(this.dasSource, {
            credentials: this.dasSource.credentials,
            preflight: this.dasSource.preflight,
            clientBin: this.dasSource.clientBin,
            forceReduction: this.dasSource.forceReduction
        });

        if (!this.dasSource.uri && !this.dasSource.stylesheet_uri) {
            fs.bwgHolder.await(function(bwg) {
                if (!bwg) {
                    // Dummy version so that an error placard gets shown.
                    thisTier.stylesheet = new DASStylesheet();
                    return  thisTier.browser.refreshTier(thisTier);
                }

                if (thisTier.dasSource.collapseSuperGroups === undefined) {
                    if (bwg.definedFieldCount == 12 && bwg.fieldCount >= 14) {
                        thisTier.dasSource.collapseSuperGroups = true;
                        thisTier.bumped = false;
                        thisTier.isLabelValid = false;
                    }
                }

                if (bwg.type == 'bigbed') {
                    thisTier.stylesheet = new DASStylesheet();
                    
                    var wigStyle = new DASStyle();
                    wigStyle.glyph = 'BOX';
                    wigStyle.FGCOLOR = 'black';
                    wigStyle.BGCOLOR = 'blue'
                    wigStyle.HEIGHT = 8;
                    wigStyle.BUMP = true;
                    wigStyle.LABEL = true;
                    wigStyle.ZINDEX = 20;
                    thisTier.stylesheet.pushStyle({type: 'bigwig'}, null, wigStyle);

                    wigStyle.glyph = 'BOX';
                    wigStyle.FGCOLOR = 'black';
                    wigStyle.BGCOLOR = 'red'
                    wigStyle.HEIGHT = 10;
                    wigStyle.BUMP = true;
                    wigStyle.LABEL = true;
                    wigStyle.ZINDEX = 20;
                    thisTier.stylesheet.pushStyle({type: 'bb-translation'}, null, wigStyle);
                    
                    var tsStyle = new DASStyle();
                    tsStyle.glyph = 'BOX';
                    tsStyle.FGCOLOR = 'black';
                    tsStyle.BGCOLOR = 'white';
                    wigStyle.HEIGHT = 10;
                    tsStyle.ZINDEX = 10;
                    tsStyle.BUMP = true;
                    thisTier.stylesheet.pushStyle({type: 'bb-transcript'}, null, tsStyle);

                    var densStyle = new DASStyle();
                    densStyle.glyph = 'HISTOGRAM';
                    densStyle.COLOR1 = 'white';
                    densStyle.COLOR2 = 'black';
                    densStyle.HEIGHT=30;
                    thisTier.stylesheet.pushStyle({type: 'density'}, null, densStyle);
                } else {
                    thisTier.stylesheet = new DASStylesheet();
                    var wigStyle = new DASStyle();
                    wigStyle.glyph = 'HISTOGRAM';
                    wigStyle.COLOR1 = 'white';
                    wigStyle.COLOR2 = 'black';
                    wigStyle.HEIGHT=30;
                    thisTier.stylesheet.pushStyle({type: 'default'}, null, wigStyle);
                }
                thisTier.browser.refreshTier(thisTier);
            });
        }
    } else if (this.dasSource.bamURI || this.dasSource.bamBlob) {
        fs = new BAMFeatureSource(this.dasSource, {
            credentials: this.dasSource.credentials
        });

        if (!this.dasSource.uri && !this.dasSource.stylesheet_uri) {
            fs.bamHolder.await(function(bam) {
                thisTier.stylesheet = new DASStylesheet();
                
                var densStyle = new DASStyle();
                densStyle.glyph = 'HISTOGRAM';
                densStyle.COLOR1 = 'black';
                densStyle.COLOR2 = 'red';
                densStyle.HEIGHT=30;
                thisTier.stylesheet.pushStyle({type: 'density'}, 'low', densStyle);
                thisTier.stylesheet.pushStyle({type: 'density'}, 'medium', densStyle);

                var wigStyle = new DASStyle();
                wigStyle.glyph = 'BOX';
                wigStyle.FGCOLOR = 'black';
                wigStyle.BGCOLOR = 'blue'
                wigStyle.HEIGHT = 8;
                wigStyle.BUMP = true;
                wigStyle.LABEL = false;
                wigStyle.ZINDEX = 20;
                thisTier.stylesheet.pushStyle({type: 'bam'}, 'high', wigStyle);
//                thisTier.stylesheet.pushStyle({type: 'bam'}, 'medium', wigStyle);

                thisTier.browser.refreshTier(thisTier);
            });
        }
    } else if (this.dasSource.tier_type == 'sequence') {
        if (this.dasSource.twoBitURI) {
            ss = new TwoBitSequenceSource(this.dasSource);
        } else {
            ss = new DASSequenceSource(this.dasSource);
        }
    } else {
        fs = new DASFeatureSource(this.dasSource);
    }
    
    if (this.dasSource.mapping) {
        fs = new MappedFeatureSource(fs, this.browser.chains[this.dasSource.mapping]);
    }

    this.featureSource = fs;
    this.sequenceSource = ss;
    this.setBackground();
}

DasTier.prototype.toString = function() {
    return this.id;
}

DasTier.prototype.init = function() {
    var tier = this;

    if (tier.dasSource.uri || tier.dasSource.stylesheet_uri) {
        tier.status = 'Fetching stylesheet';
        this.dasSource.stylesheet(function(stylesheet) {
	    tier.stylesheet = stylesheet;
            tier.browser.refreshTier(tier);
        }, function() {
	    // tier.error = 'No stylesheet';
            tier.stylesheet = new DASStylesheet();
            var defStyle = new DASStyle();
            defStyle.glyph = 'BOX';
            defStyle.BGCOLOR = 'blue';
            defStyle.FGCOLOR = 'black';
            tier.stylesheet.pushStyle({type: 'default'}, null, defStyle);
            tier.browser.refreshTier(tier);
        });
    } else if (tier.dasSource.twoBitURI) {
        tier.stylesheet = new DASStylesheet();
        var defStyle = new DASStyle();
        defStyle.glyph = 'BOX';
        defStyle.BGCOLOR = 'blue';
        defStyle.FGCOLOR = 'black';
        tier.stylesheet.pushStyle({type: 'default'}, null, defStyle);
        tier.browser.refreshTier(tier);
    };
}

DasTier.prototype.styles = function(scale) {
    // alert('Old SS code called');
    if (this.stylesheet == null) {
	return null;
    } else if (this.browser.scale > 0.2) {
	return this.stylesheet.highZoomStyles;
    } else if (this.browser.scale > 0.01) {
	return this.stylesheet.mediumZoomStyles;
    } else {
	return this.stylesheet.lowZoomStyles;
    }
}

DasTier.prototype.getSource = function() {
    return this.featureSource;
}

DasTier.prototype.getDesiredTypes = function(scale) {
    var fetchTypes = [];
    var inclusive = false;
    var ssScale = zoomForScale(this.browser.scale);

    if (this.stylesheet) {
        // dlog('ss = ' + miniJSONify(this.stylesheet));
        var ss = this.stylesheet.styles;
        for (var si = 0; si < ss.length; ++si) {
            var sh = ss[si];
            if (!sh.zoom || sh.zoom == ssScale) {
                if (!sh.type || sh.type == 'default') {
                    inclusive = true;
                    break;
                } else {
                    pushnew(fetchTypes, sh.type);
                }
            }
        }
    } else {
        // inclusive = true;
        return undefined;
    }

    if (inclusive) {
        return null;
    } else {
        return fetchTypes;
    }
}

DasTier.prototype.needsSequence = function(scale ) {
    if (this.dasSource.tier_type === 'sequence' && scale < 5) {
        return true;
    } else if ((this.dasSource.bamURI || this.dasSource.bamBlob) && scale < 20) {
        return true
    }
    return false;
}

DasTier.prototype.setStatus = function(status) {
    dlog(status);
}

DasTier.prototype.viewFeatures = function(chr, min, max, scale, features, sequence) {
    this.currentFeatures = features;
    this.currentSequence = sequence;
    
    this.knownChr = chr;
    this.knownStart = min; this.knownEnd = max;
    this.status = null; this.error = null;

    this.setBackground();
    this.draw();
}

DasTier.prototype.updateStatus = function(status) {
    if (status) {
        this.currentFeatures = [];
        this.currentSequence = null;
        this.error = status;
    }
    this.setBackground();
    this.draw();
}

DasTier.prototype.draw = function() {
    var features = this.currentFeatures;
    var seq = this.currentSequence;
    if (this.dasSource.tier_type === 'sequence') {
        drawSeqTier(this, seq); 
    } else {
        drawFeatureTier(this);
    }
    this.originHaxx = 0;
    this.browser.arrangeTiers();
}

function zoomForScale(scale) {
    var ssScale;
    if (scale > 0.2) {
        ssScale = 'high';
    } else if (scale > 0.01) {
        ssScale = 'medium';
    } else  {
        ssScale = 'low';
    }
    return ssScale;
}


DasTier.prototype.setBackground = function() {            
//    if (this.knownStart) {

    var ks = this.knownStart || -100000000;
    var ke = this.knownEnd || -100000001;
        this.background.setAttribute('x', (ks - this.browser.origin) * this.browser.scale);
        this.background.setAttribute('width', (ke - this.knownStart + 1) * this.browser.scale);
//    }    
}
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// track-adder.js
//

Browser.prototype.currentlyActive = function(source) {
    for (var i = 0; i < this.tiers.length; ++i) {
        var ts = this.tiers[i].dasSource;
        if (ts.uri == source.uri || ts.uri == source.uri + '/') {
            // Special cases where we might meaningfully want two tiers of the same URI.
            if (ts.tier_type) {
                if (!source.tier_type || source.tier_type != ts.tier_type) {
                    continue;
                }
            }
            if (ts.stylesheet_uri) {
                if (!source.stylesheet_uri || source.stylesheet_uri != ts.stylesheet_uri) {
                    continue;
                }
            }

            return true;
        }
    }
    return false;
}

Browser.prototype.makeButton = function(name, tooltip) {
    var regButton = makeElement('span', name);
    regButton.style.backgroundColor = 'rgb(230,230,250)';
    regButton.style.borderStyle = 'solid';
    regButton.style.borderColor = 'red';
    regButton.style.borderWidth = '3px';
    regButton.style.padding = '4px';
    regButton.style.marginLeft = '10px';
    regButton.style.marginRight = '10px';
    // regButton.style.width = '100px';
    regButton.style['float'] = 'left';
    if (tooltip) {
        this.makeTooltip(regButton, tooltip);
    }
    return regButton;
}

function activateButton(addModeButtons, which) {
    for (var i = 0; i < addModeButtons.length; ++i) {
        var b = addModeButtons[i];
        b.style.borderColor = (b == which) ? 'red' : 'blue';
    }
}

Browser.prototype.showTrackAdder = function(ev) {
    var thisB = this;
    var mx =  ev.clientX, my = ev.clientY;
    mx +=  document.documentElement.scrollLeft || document.body.scrollLeft;
    my +=  document.documentElement.scrollTop || document.body.scrollTop;

    var popup = document.createElement('div');
    popup.appendChild(makeElement('div', null, {}, {clear: 'both', height: '10px'})); // HACK only way I've found of adding appropriate spacing in Gecko.

    var addModeButtons = [];
    var makeStab, makeStabObserver;
    var regButton = this.makeButton('Registry', 'Browse compatible datasources from the DAS registry');
    addModeButtons.push(regButton);
    for (var m in this.mappableSources) {
        var mf  = function(mm) {
            var mapButton = thisB.makeButton(thisB.chains[mm].srcTag, 'Browse datasources mapped from ' + thisB.chains[mm].srcTag);
            addModeButtons.push(mapButton);
            mapButton.addEventListener('mousedown', function(ev) {
                ev.preventDefault(); ev.stopPropagation();
                activateButton(addModeButtons, mapButton);
                makeStab(thisB.mappableSources[mm], mm);
            }, false);
        }; mf(m);
    }
    var defButton = this.makeButton('Defaults', 'Browse the default set of data for this browser');
    addModeButtons.push(defButton);
    var custButton = this.makeButton('Custom', 'Add arbitrary DAS data');
    addModeButtons.push(custButton);
    var binButton = this.makeButton('Binary', 'Add data in bigwig or bigbed format');
    addModeButtons.push(binButton);
    activateButton(addModeButtons, regButton);
    popup.appendChild(makeElement('div', addModeButtons), null);
    
    popup.appendChild(makeElement('div', null, {}, {clear: 'both', height: '10px'})); // HACK only way I've found of adding appropriate spacing in Gecko.
    
    var addButtons = [];
    var custURL, custName, custCS, custQuant, custFile;
    var customMode = false;
    var dataToFinalize = null;

    var asform = makeElement('form', null, {}, {clear: 'both'});
    asform.addEventListener('submit', function(ev) {
            ev.stopPropagation(); ev.preventDefault();
            doAdd();
            return false;
    }, true); 
    var stabHolder = document.createElement('div');
    stabHolder.style.position = 'relative';
    stabHolder.style.overflow = 'auto';
    stabHolder.style.height = '400px';
    asform.appendChild(stabHolder);

    var __mapping;
    var __sourceHolder;


    makeStab = function(msources, mapping) {
        refreshButton.style.visibility = 'visible';
        if (__sourceHolder) {
            __sourceHolder.removeListener(makeStabObserver);
        }
        __mapping = mapping;
        __sourceHolder = msources;
        __sourceHolder.addListenerAndFire(makeStabObserver);
       
    }

    makeStabObserver = function(msources) {
        customMode = false;
        addButtons = [];
        removeChildren(stabHolder);
        if (!msources) {
            stabHolder.appendChild(makeElement('p', 'Dalliance was unable to retrieve data source information from the DAS registry, please try again later'));
            return;
        }
        var stab = document.createElement('table');
        stab.style.width='100%';
        var idx = 0;

        var sources = [];
        for (var i = 0; i < msources.length; ++i) {
            sources.push(msources[i]);
        }
        
        sources.sort(function(a, b) {
            return a.name.toLowerCase().trim().localeCompare(b.name.toLowerCase().trim());
        });

        for (var i = 0; i < sources.length; ++i) {
            var source = sources[i];
            var r = document.createElement('tr');
            r.style.backgroundColor = thisB.tierBackgroundColors[idx % thisB.tierBackgroundColors.length];

            var bd = document.createElement('td');
            bd.style.textAlign = 'center';
            if (thisB.currentlyActive(source)) {
                bd.appendChild(document.createTextNode('X'));
                thisB.makeTooltip(bd, "This data source is already active.");
            } else if (!source.props || source.props.cors) {
                var b = document.createElement('input');
                b.type = 'checkbox';
                b.dalliance_source = source;
                if (__mapping) {
                    b.dalliance_mapping = __mapping;
                }
                bd.appendChild(b);
                addButtons.push(b);
                thisB.makeTooltip(bd, "Check here then click 'Add' to activate.");
            } else {
                bd.appendChild(document.createTextNode('!'));
                thisB.makeTooltip(bd, makeElement('span', ["This data source isn't accessible because it doesn't support ", makeElement('a', "CORS", {href: 'http://www.w3.org/TR/cors/'}), "."]));
            }
            r.appendChild(bd);
            var ld = document.createElement('td');
            ld.appendChild(document.createTextNode(source.name));
            if (source.desc && source.desc.length > 0) {
                thisB.makeTooltip(ld, source.desc);
            }
            r.appendChild(ld);
            stab.appendChild(r);
            ++idx;
        }
        stabHolder.appendChild(stab);
    };
    

    regButton.addEventListener('mousedown', function(ev) {
        ev.preventDefault(); ev.stopPropagation();
        activateButton(addModeButtons, regButton);
        makeStab(thisB.availableSources);
    }, false);
    defButton.addEventListener('mousedown', function(ev) {
        ev.preventDefault(); ev.stopPropagation();
        activateButton(addModeButtons, defButton);
        makeStab(new Observed(thisB.defaultSources));
    }, false);

    binButton.addEventListener('mousedown', function(ev) {
        ev.preventDefault(); ev.stopPropagation();
        activateButton(addModeButtons, binButton);
        switchToBinMode();
    }, false);


    function switchToBinMode() {
        customMode = 'bin';
        refreshButton.style.visibility = 'hidden';

        removeChildren(stabHolder);

        if (thisB.supportsBinary) {
            stabHolder.appendChild(makeElement('h2', 'Add custom URL-based data'));
            stabHolder.appendChild(makeElement('p', ['You can add indexed binary data hosted on an web server that supports CORS (', makeElement('a', 'full details', {href: 'http://www.biodalliance.org/bin.html'}), ').  Currently supported formats are bigwig, bigbed, and indexed BAM.']));

            stabHolder.appendChild(makeElement('br'));
            stabHolder.appendChild(document.createTextNode('URL: '));
            custURL = makeElement('input', '', {size: 80, value: 'http://www.biodalliance.org/datasets/ensGene.bb'});
            stabHolder.appendChild(custURL);
            custURL.focus();
            stabHolder.appendChild(makeElement('br'));
            stabHolder.appendChild(makeElement('b', '- or -'));
            stabHolder.appendChild(makeElement('br'));
            stabHolder.appendChild(document.createTextNode('File: '));
            custFile = makeElement('input', null, {type: 'file'});
            stabHolder.appendChild(custFile);
            

            stabHolder.appendChild(makeElement('p', 'Clicking the "Add" button below will initiate a series of test queries.'));
        } else {
            stabHolder.appendChild(makeElement('h2', 'Your browser does not support binary data'));
            stabHolder.appendChild(makeElement('p', 'Browsers currently known to support this feature include Google Chrome 9 or later and Mozilla Firefox 4 or later.'));
        }
        
    }

    custButton.addEventListener('mousedown', function(ev) {
        ev.preventDefault(); ev.stopPropagation();
        activateButton(addModeButtons, custButton);
        switchToCustomMode();
    }, false);

    var switchToCustomMode = function() {
        customMode = 'das';
        refreshButton.style.visibility = 'hidden';

        removeChildren(stabHolder);

        var customForm = makeElement('div');
        customForm.appendChild(makeElement('h2', 'Add custom DAS data'));
        customForm.appendChild(makeElement('p', 'This interface is intended for adding custom or lab-specific data.  Public data can be added more easily via the registry interface.'));
                
        customForm.appendChild(document.createTextNode('URL: '));
        customForm.appendChild(makeElement('br'));
        custURL = makeElement('input', '', {size: 80, value: 'http://www.derkholm.net:8080/das/medipseq_reads/'});
        customForm.appendChild(custURL);

        customForm.appendChild(makeElement('p', 'Clicking the "Add" button below will initiate a series of test queries.  If the source is password-protected, you may be prompted to enter credentials.'));
        stabHolder.appendChild(customForm);

        custURL.focus();
    }



    var addButton = document.createElement('span');
    addButton.style.backgroundColor = 'rgb(230,230,250)';
    addButton.style.borderStyle = 'solid';
    addButton.style.borderColor = 'blue';
    addButton.style.borderWidth = '3px';
    addButton.style.padding = '2px';
    addButton.style.margin = '10px';
    addButton.style.width = '150px';
    // addButton.style.float = 'left';
    addButton.appendChild(document.createTextNode('Add'));
    addButton.addEventListener('mousedown', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        doAdd();
    }, false);

    function doAdd() {
        if (customMode) {
            if (customMode === 'das') {
                var curi = custURL.value.trim();
                if (!/^.+:\/\//.exec(curi)) {
                    curi = 'http://' + curi;
                }
                var nds = new DASSource({name: 'temporary', uri: curi});
                tryAddDAS(nds);
            } else if (customMode === 'bin') {
                var opts = {name: 'temporary'};
                var fileList = custFile.files;
                if (fileList && fileList.length > 0 && fileList[0]) {
                    opts.bwgBlob = fileList[0];
                    opts.noPersist = true;
                } else {
                    var curi = custURL.value.trim();
                    if (!/^.+:\/\//.exec(curi)) {
                        curi = 'http://' + curi;
                    }
                    opts.bwgURI = curi;
                }
                var nds = new DASSource(opts);
                tryAddBin(nds);
            } else if (customMode === 'reset') {
                switchToCustomMode();
            } else if (customMode === 'reset-bin') {
                switchToBinMode(); 
            } else if (customMode === 'prompt-bai') {
                var fileList = custFile.files;
                if (fileList && fileList.length > 0 && fileList[0]) {
                    dataToFinalize.baiBlob = fileList[0];
                    completeBAM(dataToFinalize);
                } else {
                    promptForBAI(dataToFinalize);
                }
            } else if (customMode === 'finalize') {
                dataToFinalize.name = custName.value;
                var m = custCS.value;
                if (m != '__default__') {
                    dataToFinalize.mapping = m;
                } else {
                    dataToFinalize.mapping = undefined;
                }
                if (custQuant) {
                    dataToFinalize.maxbins = custQuant.checked;
                }

                thisB.sources.push(dataToFinalize);
                thisB.makeTier(dataToFinalize);
	        thisB.storeStatus();
                thisB.removeAllPopups();
            }
        } else {
            for (var bi = 0; bi < addButtons.length; ++bi) {
                var b = addButtons[bi];
                if (b.checked) {
                    var nds = b.dalliance_source;
	            thisB.sources.push(nds);
                    thisB.makeTier(nds);
		    thisB.storeStatus();
                }
            }
            thisB.removeAllPopups();
        }
    };

    var tryAddDAS = function(nds, retry) {
        var knownSpace = thisB.knownSpace;
        if (!knownSpace) {
            alert("Can't confirm track-addition to an uninit browser.");
            return;
        }
        var tsm = Math.max(knownSpace.min, (knownSpace.min + knownSpace.max - 100) / 2)|0;
        var testSegment = new DASSegment(knownSpace.chr, tsm, Math.min(tsm + 99, knownSpace.max));
//        dlog('test segment: ' + testSegment);
        nds.features(testSegment, {}, function(features, status) {
            // dlog('status=' + status);
            if (status) {
                if (!retry) {
                    dlog('retrying with credentials');
                    nds.credentials = true;
                    tryAddDAS(nds, true);
                } else {
                    removeChildren(stabHolder);
                    stabHolder.appendChild(makeElement('h2', 'Custom data not found'));
                    stabHolder.appendChild(makeElement('p', 'DAS uri: ' + nds.uri + ' is not answering features requests'));
                    customMode = 'reset';
                    return;
                }
            } else {
                var nameExtractPattern = new RegExp('/([^/]+)/?$');
                var match = nameExtractPattern.exec(nds.uri);
                if (match) {
                    nds.name = match[1];
                }

                tryAddDASxSources(nds);
                return;
            }
        });
    }

    function tryAddDASxSources(nds, retry) {
        var uri = nds.uri;
        if (retry) {
            var match = /(.+)\/[^\/]+\/?/.exec(uri);
            if (match) {
                uri = match[1] + '/sources';
            }
        }
//        dlog('sourceQuery: ' + uri);
        function sqfail() {
            if (!retry) {
                return tryAddDASxSources(nds, true);
            } else {
                return addDasCompletionPage(nds);
            }
        }
        new DASRegistry(uri, {credentials: nds.credentials}).sources(
            function(sources) {
                if (!sources || sources.length == 0) {
                    return sqfail();
                } 
//                dlog('got ' + sources.length + ' sources');

                var fs = null;
                if (sources.length == 1) {
                    fs = sources[0];
                } else {
                    for (var i = 0; i < sources.length; ++i) {
                        if (sources[i].uri === nds.uri) {
//                            dlog('got match!');
                            fs = sources[i];
                            break;
                        }
                    }
                }

                var coordsDetermined = false, quantDetermined = false;
                if (fs) {
                    nds.name = fs.name;
                    nds.desc = fs.desc;
                    if (fs.maxbins) {
                        nds.maxbins = true;
                    } else {
                        nds.maxbins = false;
                    }
                    quantDetermined = true
                    
                    if (fs.coords && fs.coords.length == 1) {
                        var coords = fs.coords[0];
                        if (coordsMatch(coords, thisB.coordSystem)) {
                            coordsDetermined = true;
                        } else if (thisB.chains) {
                            for (var k in thisB.chains) {
                                if (coordsMatch(coords, thisB.chains[k].coords)) {
                                    nds.mapping = k;
                                    coordsDetermined = true;
                                }
                            }
                        }
                    }
                    
                }
                return addDasCompletionPage(nds, coordsDetermined, quantDetermined);
            },
            function() {
                return sqfail();
            }
        );
    }

    var tryAddBin = function(nds) {
        var fetchable;
        if (nds.bwgURI) {
            fetchable = new URLFetchable(nds.bwgURI);
        } else {
            fetchable = new BlobFetchable(nds.bwgBlob);
        }

        fetchable.slice(0, 1<<16).fetch(function(result, error) {
            if (!result) {
                removeChildren(stabHolder);
                stabHolder.appendChild(makeElement('h2', 'Custom data not found'));
                if (nds.bwgURI) {
                    stabHolder.appendChild(makeElement('p', 'Data URI: ' + nds.bwgURI + ' is not accessible.'));
                } else {
                    stabHolder.appendChild(makeElement('p', 'File access failed, are you using an up-to-date browser?'));
                }

                if (error) {
                    stabHolder.appendChild(makeElement('p', '' + error));
                }
                stabHolder.appendChild(makeElement('p', 'If in doubt, please check that the server where the file is hosted supports CORS.'));
                customMode = 'reset-bin';
                return;
            }

            var ba = new Uint8Array(result);
            var magic = readInt(ba, 0);
            if (magic == BIG_WIG_MAGIC || magic == BIG_BED_MAGIC) {
                var nameExtractPattern = new RegExp('/?([^/]+?)(.bw|.bb|.bigWig|.bigBed)?$');
                var match = nameExtractPattern.exec(nds.bwgURI || nds.bwgBlob.name);
                if (match) {
                    nds.name = match[1];
                }

                return addDasCompletionPage(nds, false, false, true);
            } else {
                if (ba[0] != 31 || ba[1] != 139) {
                    return binFormatErrorPage();
                }
                var unc = unbgzf(result);
                var uncba = new Uint8Array(unc);
                magic = readInt(uncba, 0);
                if (magic == BAM_MAGIC) {
                    if (nds.bwgBlob) {
                        return promptForBAI(nds);
                    } else {
                        return completeBAM(nds);
                    }
                } else {
                    // maybe Tabix?
                   return binFormatErrorPage();
                }
            }
        });
    }

    function promptForBAI(nds) {
        removeChildren(stabHolder);
        customMode = 'prompt-bai'
        stabHolder.appendChild(makeElement('h2', 'Select an index file'));
        stabHolder.appendChild(makeElement('p', 'Dalliance requires a BAM index (.bai) file when displaying BAM data.  These normally accompany BAM files.  For security reasons, web applications like Dalliance can only access local files which you have explicity selected.  Please use the file chooser below to select the appropriate BAI file'));

        stabHolder.appendChild(document.createTextNode('Index file: '));
        custFile = makeElement('input', null, {type: 'file'});
        stabHolder.appendChild(custFile);
        dataToFinalize = nds;
    }

    function completeBAM(nds) {
        var indexF;
        if (nds.baiBlob) {
            indexF = new BlobFetchable(nds.baiBlob);
        } else {
            indexF = new URLFetchable(nds.bwgURI + '.bai');
        }
        indexF.slice(0, 256).fetch(function(r) {
                var hasBAI = false;
                if (r) {
                    var ba = new Uint8Array(r);
                    var magic2 = readInt(ba, 0);
                    hasBAI = (magic2 == BAI_MAGIC);
                }
                if (hasBAI) {
                    var nameExtractPattern = new RegExp('/?([^/]+?)(.bam)?$');
                    var match = nameExtractPattern.exec(nds.bwgURI || nds.bwgBlob.name);
                    if (match) {
                        nds.name = match[1];
                    }

                    nds.bamURI = nds.bwgURI;
                    nds.bamBlob = nds.bwgBlob;
                    nds.bwgURI = undefined;
                    nds.bwgBlob = undefined;
                            
                    return addDasCompletionPage(nds, false, false, true);
                } else {
                    return binFormatErrorPage('You have selected a valid BAM file, but a corresponding index (.bai) file was not found.  Please index your BAM (samtools index) and place the BAI file in the same directory');
                }
        });
    }

    function binFormatErrorPage(message) {
        removeChildren(stabHolder);
        message = message || 'Custom data format not recognized';
        stabHolder.appendChild(makeElement('h2', 'Error adding custom data'));
        stabHolder.appendChild(makeElement('p', message));
        stabHolder.appendChild(makeElement('p', 'Currently supported formats are bigBed, bigWig, and BAM.'));
        customMode = 'reset-bin';
        return;
    }
                     
    var addDasCompletionPage = function(nds, coordsDetermined, quantDetermined, quantIrrelevant) {
        removeChildren(stabHolder);
        stabHolder.appendChild(makeElement('h2', 'Add custom data: step 2'));
        stabHolder.appendChild(document.createTextNode('Label: '));
        custName = makeElement('input', '', {value: nds.name});
        stabHolder.appendChild(custName);
        stabHolder.appendChild(makeElement('br'));
        stabHolder.appendChild(makeElement('br'));
        stabHolder.appendChild(makeElement('h4', 'Coordinate system: '));
        custCS = makeElement('select', null);
        custCS.appendChild(makeElement('option', thisB.coordSystem.auth + thisB.coordSystem.version, {value: '__default__'}));
        if (thisB.chains) {
            for (var csk in thisB.chains) {
                var cs = thisB.chains[csk].coords;
                custCS.appendChild(makeElement('option', cs.auth + cs.version, {value: csk}));
            }
        }
        custCS.value = nds.mapping || '__default__';
        stabHolder.appendChild(custCS);

        if (coordsDetermined) {
            stabHolder.appendChild(makeElement('p', "(Based on server response, probably doesn't need changing.)"));
        } else {
            stabHolder.appendChild(makeElement('p', [makeElement('b', 'Warning: '), "unable to determine the correct value from server responses.  Please check carefully."]));
            stabHolder.appendChild(makeElement('p', "If you don't see the mapping you're looking for, please contact thomas@biodalliance.org"));
        }

        if (!quantIrrelevant) {
            stabHolder.appendChild(document.createTextNode('Quantitative: '));
            custQuant = makeElement('input', null, {type: 'checkbox', checked: true});
            if (typeof nds.maxbins !== 'undefined') {
                custQuant.checked = nds.maxbins;
            }
            stabHolder.appendChild(custQuant);
            if (quantDetermined) {
                stabHolder.appendChild(makeElement('p', "(Based on server response, probably doesn't need changing.)"));
            } else {
                stabHolder.appendChild(makeElement('p', [makeElement('b', "Warning: "), "unable to determine correct value.  If in doubt, leave checked."]));
            }
        }

        if (nds.bwgBlob) {
            stabHolder.appendChild(makeElement('p', [makeElement('b', 'Warning: '), 'data added from local file.  Due to the browser security model, the track will disappear if you reload Dalliance.']));
        }

        custName.focus();
        customMode = 'finalize';
        dataToFinalize = nds;
    }


    var canButton = document.createElement('span');
    canButton.style.backgroundColor = 'rgb(230,230,250)';
    canButton.style.borderStyle = 'solid';
    canButton.style.borderColor = 'blue';
    canButton.style.borderWidth = '3px';
    canButton.style.padding = '2px';
    canButton.style.margin = '10px';
    canButton.style.width = '150px';
    // canButton.style.float = 'left';
    canButton.appendChild(document.createTextNode('Cancel'))
    canButton.addEventListener('mousedown', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        thisB.removeAllPopups();
    }, false);

    var refreshButton = makeElement('span', 'Refresh');
    refreshButton.style.backgroundColor = 'rgb(230,230,250)';
    refreshButton.style.borderStyle = 'solid';
    refreshButton.style.borderColor = 'blue';
    refreshButton.style.borderWidth = '3px';
    refreshButton.style.padding = '2px';
    refreshButton.style.margin = '10px';
    refreshButton.style.width = '120px';
    refreshButton.addEventListener('mousedown', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        thisB.queryRegistry(__mapping);
    }, false);
    this.makeTooltip(refreshButton, 'Click to re-fetch data from the DAS registry');

    var buttonHolder = makeElement('div', [addButton, canButton, refreshButton]);
    buttonHolder.style.margin = '10px';
    asform.appendChild(buttonHolder);

    popup.appendChild(asform);
    makeStab(thisB.availableSources);

    return this.popit(ev, 'Add DAS data', popup, {width: 600});
}
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// twoBit.js: packed-binary reference sequences
//

var TWOBIT_MAGIC = 0x1a412743;

function TwoBitFile() {
}

function makeTwoBit(fetchable, cnt) {
    var tb = new TwoBitFile();
    tb.data = fetchable;

    tb.data.slice(0, 1024).fetch(function(r) {
	if (!r) {
	    return cnt(null, "Couldn't access data");
	}
	var ba = new Uint8Array(r);
	var magic = readInt(ba, 0);
	if (magic != TWOBIT_MAGIC) {
	    return cnt(null, "Not a .2bit fie");
	}

	var version = readInt(ba, 4);
	if (version != 0) {
	    return cnt(null, 'Unsupported version ' + version);
	}
	
	tb.seqCount = readInt(ba, 8);
	tb.seqDict = {};
	var p = 16;
	for (var i = 0; i < tb.seqCount; ++i) {
	    var ns = ba[p++];
	    var name = '';
	    for (var j = 1; j <= ns; ++j) {
		name += String.fromCharCode(ba[p++]);
	    }
	    var offset = readInt(ba, p);
	    p += 4;
	    tb.seqDict[name] = new TwoBitSeq(tb, offset);
	}
	return cnt(tb);
    });
}

TwoBitFile.prototype.getSeq = function(chr) {
    var seq = this.seqDict[chr];
    if (!seq) {
        seq = this.seqDict['chr' + chr];
    }
    return seq;
}

TwoBitFile.prototype.fetch = function(chr, min, max, cnt) {
    var seq = this.getSeq(chr);
    if (!seq) {
	return cnt(null, "Couldn't find " + chr);
    } else {
	seq.fetch(min, max, cnt);
    }
}

function TwoBitSeq(tbf, offset) {
    this.tbf = tbf;
    this.offset = offset;
}

TwoBitSeq.prototype.init = function(cnt) {
    if (this.seqOffset) {
	return cnt();
    }

    var thisB = this;
    thisB.tbf.data.slice(thisB.offset, 8).fetch(function(r1) {
	if (!r1) {
	    return cnt('Fetch failed');
	}
	var ba = new Uint8Array(r1);
	thisB.length = readInt(ba, 0);
	thisB.nBlockCnt = readInt(ba, 4);
	thisB.tbf.data.slice(thisB.offset + 8, thisB.nBlockCnt*8 + 4).fetch(function(r2) {
	    if (!r2) {
		return cnt('Fetch failed');
	    }
	    var ba = new Uint8Array(r2);
            var nbs = null;
            for (var b = 0; b < thisB.nBlockCnt; ++b) {
                var nbMin = readInt(ba, b * 4);
                var nbLen = readInt(ba, (b + thisB.nBlockCnt) * 4);
                var nb = new Range(nbMin, nbMin + nbLen - 1);
                if (!nbs) {
                    nbs = nb;
                } else {
                    nbs = union(nbs, nb);
                }
            }
            thisB.nBlocks = nbs;
	    thisB.mBlockCnt = readInt(ba, thisB.nBlockCnt*8);
	    thisB.seqLength = ((thisB.length + 3)/4)|0;
            thisB.seqOffset = thisB.offset + 16 + ((thisB.nBlockCnt + thisB.mBlockCnt) * 8);
            return cnt();
	});
    });
}

var TWOBIT_TABLE = ['T', 'C', 'A', 'G'];

TwoBitSeq.prototype.fetch = function(min, max, cnt) {
    --min; --max;       // Switch to zero-based.
    var thisB = this;
    this.init(function(error) {
	if (error) {
	    return cnt(null, error);
	}

        var fetchMin = min >> 2;
        var fetchMax = max + 3 >> 2;
        if (fetchMin < 0 || fetchMax > thisB.seqLength) {
            return cnt('Coordinates out of bounds: ' + min + ':' + max);
        }

        thisB.tbf.data.slice(thisB.seqOffset + fetchMin, fetchMax - fetchMin).fetch(function(r) {
            if (r == null) {
                return cnt('SeqFetch failed');
            }
            var seqData = new Uint8Array(r);

            var nSpans = [];
            if (thisB.nBlocks) {
                var intr = intersection(new Range(min, max), thisB.nBlocks);
                if (intr) {
                    nSpans = intr.ranges();
                }
            }
            
	    var seqstr = '';
            var ptr = min;
            function fillSeq(fsm) {
                while (ptr <= fsm) {
                    var bb = (ptr >> 2) - fetchMin;
	            var ni = ptr & 0x3;
	            var bv = seqData[bb];
	            var n;
	            if (ni == 0) {
		        n = (bv >> 6) & 0x3;
	            } else if (ni == 1) {
		        n = (bv >> 4) & 0x3;
	            } else if (ni == 2) {
		        n = (bv >> 2) & 0x3;
	            } else {
		        n = (bv) & 0x3;
	            }
	            seqstr += TWOBIT_TABLE[n];
                    ++ptr;
	        }
            }
            
            for (var b = 0; b < nSpans.length; ++b) {
                var nb = nSpans[b];
                if (ptr > nb.min()) {
                    throw 'N mismatch...';
                }
                if (ptr < nb.min()) {
                    fillSeq(nb.min() - 1);
                }
                while (ptr < nb.max()) {
                    seqstr += 'N';
                    ++ptr;
                }
            }
            if (ptr < max) {
                fillSeq(max);
            }

	    return cnt(seqstr);
        });
    });
}

TwoBitSeq.prototype.length = function(cnt) {
    var thisB = this;
    this.init(function(error) {
        if (error) {
            return cnt(null, error);
        } else {
            return cnt(thisB.length);
        }
    });
}
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// utils.js: odds, sods, and ends.
//

var NUM_REGEXP = new RegExp('[0-9]+');

function stringToNumbersArray(str) {
    var nums = new Array();
    var m;
    while (m = NUM_REGEXP.exec(str)) {
        nums.push(m[0]);
        str=str.substring(m.index + (m[0].length));
    }
    return nums;
}

var STRICT_NUM_REGEXP = new RegExp('^[0-9]+$');

function stringToInt(str) {
    str = str.replace(new RegExp(',', 'g'), '');
    if (!STRICT_NUM_REGEXP.test(str)) {
	alert("Don't understand '" + str + "'");
	return null;
    }
    return str|0;
}

function pushnew(a, v) {
    for (var i = 0; i < a.length; ++i) {
        if (a[i] == v) {
            return;
        }
    }
    a.push(v);
}

function pusho(obj, k, v) {
    if (obj[k]) {
	obj[k].push(v);
    } else {
	obj[k] = [v];
    }
}

function pushnewo(obj, k, v) {
    var a = obj[k];
    if (a) {
	for (var i = 0; i < a.length; ++i) {    // indexOf requires JS16 :-(.
	    if (a[i] == v) {
		return;
	    }
	}
	a.push(v);
    } else {
	obj[k] = [v];
    }
}


function pick(a, b, c, d)
{
    if (a) {
        return a;
    } else if (b) {
        return b;
    } else if (c) {
        return c;
    } else if (d) {
        return d;
    }
}

function pushnew(l, o)
{
    for (var i = 0; i < l.length; ++i) {
        if (l[i] == o) {
            return;
        }
    }
    l.push(o);
}

function maybeConcat(a, b) {
    var l = [];
    if (a) {
        for (var i = 0; i < a.length; ++i) {
            pushnew(l, a[i]);
        }
    }
    if (b) {
        for (var i = 0; i < b.length; ++i) {
            pushnew(l, b[i]);
        }
    }
    return l;
}

function arrayIndexOf(a, x) {
    if (!a) {
        return -1;
    }

    for (var i = 0; i < a.length; ++i) {
        if (a[i] === x) {
            return i;
        }
    }
    return -1;
}

function arrayRemove(a, x) {
    var i = arrayIndexOf(a, x);
    if (i >= 0) {
        a.splice(i, 1);
        return true;
    }
    return false;
}

//
// DOM utilities
//


function makeElement(tag, children, attribs, styles)
{
    var ele = document.createElement(tag);
    if (children) {
        if (! (children instanceof Array)) {
            children = [children];
        }
        for (var i = 0; i < children.length; ++i) {
            var c = children[i];
            if (typeof c == 'string') {
                c = document.createTextNode(c);
            }
            ele.appendChild(c);
        }
    }
    
    if (attribs) {
        for (var l in attribs) {
            ele[l] = attribs[l];
        }
    }
    if (styles) {
        for (var l in styles) {
            ele.style[l] = styles[l];
        }
    }
    return ele;
}

function makeElementNS(namespace, tag, children, attribs)
{
    var ele = document.createElementNS(namespace, tag);
    if (children) {
        if (! (children instanceof Array)) {
            children = [children];
        }
        for (var i = 0; i < children.length; ++i) {
            var c = children[i];
            if (typeof c == 'string') {
                c = document.createTextNode(c);
            }
            ele.appendChild(c);
        }
    }
    
    setAttrs(ele, attribs);
    return ele;
}

var attr_name_cache = {};

function setAttr(node, key, value)
{
    var attr = attr_name_cache[key];
    if (!attr) {
        var _attr = '';
        for (var c = 0; c < key.length; ++c) {
            var cc = key.substring(c, c+1);
            var lcc = cc.toLowerCase();
            if (lcc != cc) {
                _attr = _attr + '-' + lcc;
            } else {
                _attr = _attr + cc;
            }
        }
        attr_name_cache[key] = _attr;
        attr = _attr;
    }
    node.setAttribute(attr, value);
}

function setAttrs(node, attribs)
{
    if (attribs) {
        for (var l in attribs) {
            setAttr(node, l, attribs[l]);
        }
    }
}



function removeChildren(node)
{
    if (!node || !node.childNodes) {
        return;
    }

    while (node.childNodes.length > 0) {
        node.removeChild(node.firstChild);
    }
}



//
// WARNING: not for general use!
//

function miniJSONify(o) {
    if (typeof o === 'undefined') {
        return 'undefined';
    } else if (o == null) {
        return 'null';
    } else if (typeof o == 'string') {
	return "'" + o + "'";
    } else if (typeof o == 'number') {
	return "" + o;
    } else if (typeof o == 'boolean') {
	return "" + o;
    } else if (typeof o == 'object') {
	if (o instanceof Array) {
	    var s = null;
	    for (var i = 0; i < o.length; ++i) {
		s = (s == null ? '' : (s + ', ')) + miniJSONify(o[i]);
	    }
	    return '[' + (s?s:'') + ']';
	} else {
	    var s = null;
	    for (var k in o) {
		if (k != undefined && typeof(o[k]) != 'function') {
		    s = (s == null ? '' : (s + ', ')) + k + ': ' + miniJSONify(o[k]);
		}
	    }
	    return '{' + (s?s:'') + '}';
	}
    } else {
	return (typeof o);
    }
}

function shallowCopy(o) {
    n = {};
    for (k in o) {
        n[k] = o[k];
    }
    return n;
}

function Observed(x) {
    this.value = x;
    this.listeners = [];
}

Observed.prototype.addListener = function(f) {
    this.listeners.push(f);
}

Observed.prototype.addListenerAndFire = function(f) {
    this.listeners.push(f);
    f(this.value);
}

Observed.prototype.removeListener = function(f) {
    arrayRemove(this.listeners, f);
}

Observed.prototype.get = function() {
    return this.value;
}

Observed.prototype.set = function(x) {
    this.value = x;
    for (var i = 0; i < this.listeners.length; ++i) {
        this.listeners[i](x);
    }
}

function Awaited() {
    this.queue = [];
}

Awaited.prototype.provide = function(x) {
    if (this.res) {
	throw "Resource has already been provided.";
    }

    this.res = x;
    for (var i = 0; i < this.queue.length; ++i) {
	this.queue[i](x);
    }
}

Awaited.prototype.await = function(f) {
    if (this.res) {
	f(this.res);
        return this.res;
    } else {
	this.queue.push(f);
    }
}


//
// Missing APIs
// 

if (!('trim' in String.prototype)) {
    String.prototype.trim = function() {
        return this.replace(/^\s+/, '').replace(/\s+$/, '');
    };
}
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// version.js
//

var VERSION = {
    CONFIG: 3,
    MAJOR:  0,
    MINOR:  6,
    MICRO:  5,
    PATCH:  '',
    BRANCH: ''
}

VERSION.toString = function() {
    var vs = '' + this.MAJOR + '.' + this.MINOR + '.' + this.MICRO;
    if (this.PATCH) {
        vs = vs + this.PATCH;
    }
    if (this.BRANCH && this.BRANCH != '') {
        vs = vs + '-' + this.BRANCH;
    }
    return vs;
}
/*
    http://www.JSON.org/json2.js
    2011-01-18

    Public Domain.

    NO WARRANTY EXPRESSED OR IMPLIED. USE AT YOUR OWN RISK.

    See http://www.JSON.org/js.html


    This code should be minified before deployment.
    See http://javascript.crockford.com/jsmin.html

    USE YOUR OWN COPY. IT IS EXTREMELY UNWISE TO LOAD CODE FROM SERVERS YOU DO
    NOT CONTROL.


    This file creates a global JSON object containing two methods: stringify
    and parse.

        JSON.stringify(value, replacer, space)
            value       any JavaScript value, usually an object or array.

            replacer    an optional parameter that determines how object
                        values are stringified for objects. It can be a
                        function or an array of strings.

            space       an optional parameter that specifies the indentation
                        of nested structures. If it is omitted, the text will
                        be packed without extra whitespace. If it is a number,
                        it will specify the number of spaces to indent at each
                        level. If it is a string (such as '\t' or '&nbsp;'),
                        it contains the characters used to indent at each level.

            This method produces a JSON text from a JavaScript value.

            When an object value is found, if the object contains a toJSON
            method, its toJSON method will be called and the result will be
            stringified. A toJSON method does not serialize: it returns the
            value represented by the name/value pair that should be serialized,
            or undefined if nothing should be serialized. The toJSON method
            will be passed the key associated with the value, and this will be
            bound to the value

            For example, this would serialize Dates as ISO strings.

                Date.prototype.toJSON = function (key) {
                    function f(n) {
                        // Format integers to have at least two digits.
                        return n < 10 ? '0' + n : n;
                    }

                    return this.getUTCFullYear()   + '-' +
                         f(this.getUTCMonth() + 1) + '-' +
                         f(this.getUTCDate())      + 'T' +
                         f(this.getUTCHours())     + ':' +
                         f(this.getUTCMinutes())   + ':' +
                         f(this.getUTCSeconds())   + 'Z';
                };

            You can provide an optional replacer method. It will be passed the
            key and value of each member, with this bound to the containing
            object. The value that is returned from your method will be
            serialized. If your method returns undefined, then the member will
            be excluded from the serialization.

            If the replacer parameter is an array of strings, then it will be
            used to select the members to be serialized. It filters the results
            such that only members with keys listed in the replacer array are
            stringified.

            Values that do not have JSON representations, such as undefined or
            functions, will not be serialized. Such values in objects will be
            dropped; in arrays they will be replaced with null. You can use
            a replacer function to replace those with JSON values.
            JSON.stringify(undefined) returns undefined.

            The optional space parameter produces a stringification of the
            value that is filled with line breaks and indentation to make it
            easier to read.

            If the space parameter is a non-empty string, then that string will
            be used for indentation. If the space parameter is a number, then
            the indentation will be that many spaces.

            Example:

            text = JSON.stringify(['e', {pluribus: 'unum'}]);
            // text is '["e",{"pluribus":"unum"}]'


            text = JSON.stringify(['e', {pluribus: 'unum'}], null, '\t');
            // text is '[\n\t"e",\n\t{\n\t\t"pluribus": "unum"\n\t}\n]'

            text = JSON.stringify([new Date()], function (key, value) {
                return this[key] instanceof Date ?
                    'Date(' + this[key] + ')' : value;
            });
            // text is '["Date(---current time---)"]'


        JSON.parse(text, reviver)
            This method parses a JSON text to produce an object or array.
            It can throw a SyntaxError exception.

            The optional reviver parameter is a function that can filter and
            transform the results. It receives each of the keys and values,
            and its return value is used instead of the original value.
            If it returns what it received, then the structure is not modified.
            If it returns undefined then the member is deleted.

            Example:

            // Parse the text. Values that look like ISO date strings will
            // be converted to Date objects.

            myData = JSON.parse(text, function (key, value) {
                var a;
                if (typeof value === 'string') {
                    a =
/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)Z$/.exec(value);
                    if (a) {
                        return new Date(Date.UTC(+a[1], +a[2] - 1, +a[3], +a[4],
                            +a[5], +a[6]));
                    }
                }
                return value;
            });

            myData = JSON.parse('["Date(09/09/2001)"]', function (key, value) {
                var d;
                if (typeof value === 'string' &&
                        value.slice(0, 5) === 'Date(' &&
                        value.slice(-1) === ')') {
                    d = new Date(value.slice(5, -1));
                    if (d) {
                        return d;
                    }
                }
                return value;
            });


    This is a reference implementation. You are free to copy, modify, or
    redistribute.
*/

/*jslint evil: true, strict: false, regexp: false */

/*members "", "\b", "\t", "\n", "\f", "\r", "\"", JSON, "\\", apply,
    call, charCodeAt, getUTCDate, getUTCFullYear, getUTCHours,
    getUTCMinutes, getUTCMonth, getUTCSeconds, hasOwnProperty, join,
    lastIndex, length, parse, prototype, push, replace, slice, stringify,
    test, toJSON, toString, valueOf
*/


// Create a JSON object only if one does not already exist. We create the
// methods in a closure to avoid creating global variables.

var JSON;
if (!JSON) {
    JSON = {};
}

(function () {
    "use strict";

    function f(n) {
        // Format integers to have at least two digits.
        return n < 10 ? '0' + n : n;
    }

    if (typeof Date.prototype.toJSON !== 'function') {

        Date.prototype.toJSON = function (key) {

            return isFinite(this.valueOf()) ?
                this.getUTCFullYear()     + '-' +
                f(this.getUTCMonth() + 1) + '-' +
                f(this.getUTCDate())      + 'T' +
                f(this.getUTCHours())     + ':' +
                f(this.getUTCMinutes())   + ':' +
                f(this.getUTCSeconds())   + 'Z' : null;
        };

        String.prototype.toJSON      =
            Number.prototype.toJSON  =
            Boolean.prototype.toJSON = function (key) {
                return this.valueOf();
            };
    }

    var cx = /[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
        escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
        gap,
        indent,
        meta = {    // table of character substitutions
            '\b': '\\b',
            '\t': '\\t',
            '\n': '\\n',
            '\f': '\\f',
            '\r': '\\r',
            '"' : '\\"',
            '\\': '\\\\'
        },
        rep;


    function quote(string) {

// If the string contains no control characters, no quote characters, and no
// backslash characters, then we can safely slap some quotes around it.
// Otherwise we must also replace the offending characters with safe escape
// sequences.

        escapable.lastIndex = 0;
        return escapable.test(string) ? '"' + string.replace(escapable, function (a) {
            var c = meta[a];
            return typeof c === 'string' ? c :
                '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
        }) + '"' : '"' + string + '"';
    }


    function str(key, holder) {

// Produce a string from holder[key].

        var i,          // The loop counter.
            k,          // The member key.
            v,          // The member value.
            length,
            mind = gap,
            partial,
            value = holder[key];

// If the value has a toJSON method, call it to obtain a replacement value.

        if (value && typeof value === 'object' &&
                typeof value.toJSON === 'function') {
            value = value.toJSON(key);
        }

// If we were called with a replacer function, then call the replacer to
// obtain a replacement value.

        if (typeof rep === 'function') {
            value = rep.call(holder, key, value);
        }

// What happens next depends on the value's type.

        switch (typeof value) {
        case 'string':
            return quote(value);

        case 'number':

// JSON numbers must be finite. Encode non-finite numbers as null.

            return isFinite(value) ? String(value) : 'null';

        case 'boolean':
        case 'null':

// If the value is a boolean or null, convert it to a string. Note:
// typeof null does not produce 'null'. The case is included here in
// the remote chance that this gets fixed someday.

            return String(value);

// If the type is 'object', we might be dealing with an object or an array or
// null.

        case 'object':

// Due to a specification blunder in ECMAScript, typeof null is 'object',
// so watch out for that case.

            if (!value) {
                return 'null';
            }

// Make an array to hold the partial results of stringifying this object value.

            gap += indent;
            partial = [];

// Is the value an array?

            if (Object.prototype.toString.apply(value) === '[object Array]') {

// The value is an array. Stringify every element. Use null as a placeholder
// for non-JSON values.

                length = value.length;
                for (i = 0; i < length; i += 1) {
                    partial[i] = str(i, value) || 'null';
                }

// Join all of the elements together, separated with commas, and wrap them in
// brackets.

                v = partial.length === 0 ? '[]' : gap ?
                    '[\n' + gap + partial.join(',\n' + gap) + '\n' + mind + ']' :
                    '[' + partial.join(',') + ']';
                gap = mind;
                return v;
            }

// If the replacer is an array, use it to select the members to be stringified.

            if (rep && typeof rep === 'object') {
                length = rep.length;
                for (i = 0; i < length; i += 1) {
                    k = rep[i];
                    if (typeof k === 'string') {
                        v = str(k, value);
                        if (v) {
                            partial.push(quote(k) + (gap ? ': ' : ':') + v);
                        }
                    }
                }
            } else {

// Otherwise, iterate through all of the keys in the object.

                for (k in value) {
                    if (Object.hasOwnProperty.call(value, k)) {
                        v = str(k, value);
                        if (v) {
                            partial.push(quote(k) + (gap ? ': ' : ':') + v);
                        }
                    }
                }
            }

// Join all of the member texts together, separated with commas,
// and wrap them in braces.

            v = partial.length === 0 ? '{}' : gap ?
                '{\n' + gap + partial.join(',\n' + gap) + '\n' + mind + '}' :
                '{' + partial.join(',') + '}';
            gap = mind;
            return v;
        }
    }

// If the JSON object does not yet have a stringify method, give it one.

    if (typeof JSON.stringify !== 'function') {
        JSON.stringify = function (value, replacer, space) {

// The stringify method takes a value and an optional replacer, and an optional
// space parameter, and returns a JSON text. The replacer can be a function
// that can replace values, or an array of strings that will select the keys.
// A default replacer method can be provided. Use of the space parameter can
// produce text that is more easily readable.

            var i;
            gap = '';
            indent = '';

// If the space parameter is a number, make an indent string containing that
// many spaces.

            if (typeof space === 'number') {
                for (i = 0; i < space; i += 1) {
                    indent += ' ';
                }

// If the space parameter is a string, it will be used as the indent string.

            } else if (typeof space === 'string') {
                indent = space;
            }

// If there is a replacer, it must be a function or an array.
// Otherwise, throw an error.

            rep = replacer;
            if (replacer && typeof replacer !== 'function' &&
                    (typeof replacer !== 'object' ||
                    typeof replacer.length !== 'number')) {
                throw new Error('JSON.stringify');
            }

// Make a fake root object containing our value under the key of ''.
// Return the result of stringifying the value.

            return str('', {'': value});
        };
    }


// If the JSON object does not yet have a parse method, give it one.

    if (typeof JSON.parse !== 'function') {
        JSON.parse = function (text, reviver) {

// The parse method takes a text and an optional reviver function, and returns
// a JavaScript value if the text is a valid JSON text.

            var j;

            function walk(holder, key) {

// The walk method is used to recursively walk the resulting structure so
// that modifications can be made.

                var k, v, value = holder[key];
                if (value && typeof value === 'object') {
                    for (k in value) {
                        if (Object.hasOwnProperty.call(value, k)) {
                            v = walk(value, k);
                            if (v !== undefined) {
                                value[k] = v;
                            } else {
                                delete value[k];
                            }
                        }
                    }
                }
                return reviver.call(holder, key, value);
            }


// Parsing happens in four stages. In the first stage, we replace certain
// Unicode characters with escape sequences. JavaScript handles many characters
// incorrectly, either silently deleting them, or treating them as line endings.

            text = String(text);
            cx.lastIndex = 0;
            if (cx.test(text)) {
                text = text.replace(cx, function (a) {
                    return '\\u' +
                        ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
                });
            }

// In the second stage, we run the text against regular expressions that look
// for non-JSON patterns. We are especially concerned with '()' and 'new'
// because they can cause invocation, and '=' because it can cause mutation.
// But just to be safe, we want to reject all unexpected forms.

// We split the second stage into 4 regexp operations in order to work around
// crippling inefficiencies in IE's and Safari's regexp engines. First we
// replace the JSON backslash pairs with '@' (a non-JSON character). Second, we
// replace all simple value tokens with ']' characters. Third, we delete all
// open brackets that follow a colon or comma or that begin the text. Finally,
// we look to see that the remaining characters are only whitespace or ']' or
// ',' or ':' or '{' or '}'. If that is so, then the text is safe for eval.

            if (/^[\],:{}\s]*$/
                    .test(text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@')
                        .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
                        .replace(/(?:^|:|,)(?:\s*\[)+/g, ''))) {

// In the third stage we use the eval function to compile the text into a
// JavaScript structure. The '{' operator is subject to a syntactic ambiguity
// in JavaScript: it can begin a block or an object literal. We wrap the text
// in parens to eliminate the ambiguity.

                j = eval('(' + text + ')');

// In the optional fourth stage, we recursively walk the new structure, passing
// each name/value pair to a reviver function for possible transformation.

                return typeof reviver === 'function' ?
                    walk({'': j}, '') : j;
            }

// If the text is not JSON parseable, then a SyntaxError is thrown.

            throw new SyntaxError('JSON.parse');
        };
    }
}());
/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Javascript ZLib
// By Thomas Down 2010-2011
//
// Based very heavily on portions of jzlib (by ymnk@jcraft.com), who in
// turn credits Jean-loup Gailly and Mark Adler for the original zlib code.
//
// inflate.js: ZLib inflate code
//

//
// Shared constants
//

var MAX_WBITS=15; // 32K LZ77 window
var DEF_WBITS=MAX_WBITS;
var MAX_MEM_LEVEL=9;
var MANY=1440;
var BMAX = 15;

// preset dictionary flag in zlib header
var PRESET_DICT=0x20;

var Z_NO_FLUSH=0;
var Z_PARTIAL_FLUSH=1;
var Z_SYNC_FLUSH=2;
var Z_FULL_FLUSH=3;
var Z_FINISH=4;

var Z_DEFLATED=8;

var Z_OK=0;
var Z_STREAM_END=1;
var Z_NEED_DICT=2;
var Z_ERRNO=-1;
var Z_STREAM_ERROR=-2;
var Z_DATA_ERROR=-3;
var Z_MEM_ERROR=-4;
var Z_BUF_ERROR=-5;
var Z_VERSION_ERROR=-6;

var METHOD=0;   // waiting for method byte
var FLAG=1;     // waiting for flag byte
var DICT4=2;    // four dictionary check bytes to go
var DICT3=3;    // three dictionary check bytes to go
var DICT2=4;    // two dictionary check bytes to go
var DICT1=5;    // one dictionary check byte to go
var DICT0=6;    // waiting for inflateSetDictionary
var BLOCKS=7;   // decompressing blocks
var CHECK4=8;   // four check bytes to go
var CHECK3=9;   // three check bytes to go
var CHECK2=10;  // two check bytes to go
var CHECK1=11;  // one check byte to go
var DONE=12;    // finished check, done
var BAD=13;     // got an error--stay here

var inflate_mask = [0x00000000, 0x00000001, 0x00000003, 0x00000007, 0x0000000f, 0x0000001f, 0x0000003f, 0x0000007f, 0x000000ff, 0x000001ff, 0x000003ff, 0x000007ff, 0x00000fff, 0x00001fff, 0x00003fff, 0x00007fff, 0x0000ffff];

var IB_TYPE=0;  // get type bits (3, including end bit)
var IB_LENS=1;  // get lengths for stored
var IB_STORED=2;// processing stored block
var IB_TABLE=3; // get table lengths
var IB_BTREE=4; // get bit lengths tree for a dynamic block
var IB_DTREE=5; // get length, distance trees for a dynamic block
var IB_CODES=6; // processing fixed or dynamic block
var IB_DRY=7;   // output remaining window bytes
var IB_DONE=8;  // finished last block, done
var IB_BAD=9;   // ot a data error--stuck here

var fixed_bl = 9;
var fixed_bd = 5;

var fixed_tl = [
    96,7,256, 0,8,80, 0,8,16, 84,8,115,
    82,7,31, 0,8,112, 0,8,48, 0,9,192,
    80,7,10, 0,8,96, 0,8,32, 0,9,160,
    0,8,0, 0,8,128, 0,8,64, 0,9,224,
    80,7,6, 0,8,88, 0,8,24, 0,9,144,
    83,7,59, 0,8,120, 0,8,56, 0,9,208,
    81,7,17, 0,8,104, 0,8,40, 0,9,176,
    0,8,8, 0,8,136, 0,8,72, 0,9,240,
    80,7,4, 0,8,84, 0,8,20, 85,8,227,
    83,7,43, 0,8,116, 0,8,52, 0,9,200,
    81,7,13, 0,8,100, 0,8,36, 0,9,168,
    0,8,4, 0,8,132, 0,8,68, 0,9,232,
    80,7,8, 0,8,92, 0,8,28, 0,9,152,
    84,7,83, 0,8,124, 0,8,60, 0,9,216,
    82,7,23, 0,8,108, 0,8,44, 0,9,184,
    0,8,12, 0,8,140, 0,8,76, 0,9,248,
    80,7,3, 0,8,82, 0,8,18, 85,8,163,
    83,7,35, 0,8,114, 0,8,50, 0,9,196,
    81,7,11, 0,8,98, 0,8,34, 0,9,164,
    0,8,2, 0,8,130, 0,8,66, 0,9,228,
    80,7,7, 0,8,90, 0,8,26, 0,9,148,
    84,7,67, 0,8,122, 0,8,58, 0,9,212,
    82,7,19, 0,8,106, 0,8,42, 0,9,180,
    0,8,10, 0,8,138, 0,8,74, 0,9,244,
    80,7,5, 0,8,86, 0,8,22, 192,8,0,
    83,7,51, 0,8,118, 0,8,54, 0,9,204,
    81,7,15, 0,8,102, 0,8,38, 0,9,172,
    0,8,6, 0,8,134, 0,8,70, 0,9,236,
    80,7,9, 0,8,94, 0,8,30, 0,9,156,
    84,7,99, 0,8,126, 0,8,62, 0,9,220,
    82,7,27, 0,8,110, 0,8,46, 0,9,188,
    0,8,14, 0,8,142, 0,8,78, 0,9,252,
    96,7,256, 0,8,81, 0,8,17, 85,8,131,
    82,7,31, 0,8,113, 0,8,49, 0,9,194,
    80,7,10, 0,8,97, 0,8,33, 0,9,162,
    0,8,1, 0,8,129, 0,8,65, 0,9,226,
    80,7,6, 0,8,89, 0,8,25, 0,9,146,
    83,7,59, 0,8,121, 0,8,57, 0,9,210,
    81,7,17, 0,8,105, 0,8,41, 0,9,178,
    0,8,9, 0,8,137, 0,8,73, 0,9,242,
    80,7,4, 0,8,85, 0,8,21, 80,8,258,
    83,7,43, 0,8,117, 0,8,53, 0,9,202,
    81,7,13, 0,8,101, 0,8,37, 0,9,170,
    0,8,5, 0,8,133, 0,8,69, 0,9,234,
    80,7,8, 0,8,93, 0,8,29, 0,9,154,
    84,7,83, 0,8,125, 0,8,61, 0,9,218,
    82,7,23, 0,8,109, 0,8,45, 0,9,186,
    0,8,13, 0,8,141, 0,8,77, 0,9,250,
    80,7,3, 0,8,83, 0,8,19, 85,8,195,
    83,7,35, 0,8,115, 0,8,51, 0,9,198,
    81,7,11, 0,8,99, 0,8,35, 0,9,166,
    0,8,3, 0,8,131, 0,8,67, 0,9,230,
    80,7,7, 0,8,91, 0,8,27, 0,9,150,
    84,7,67, 0,8,123, 0,8,59, 0,9,214,
    82,7,19, 0,8,107, 0,8,43, 0,9,182,
    0,8,11, 0,8,139, 0,8,75, 0,9,246,
    80,7,5, 0,8,87, 0,8,23, 192,8,0,
    83,7,51, 0,8,119, 0,8,55, 0,9,206,
    81,7,15, 0,8,103, 0,8,39, 0,9,174,
    0,8,7, 0,8,135, 0,8,71, 0,9,238,
    80,7,9, 0,8,95, 0,8,31, 0,9,158,
    84,7,99, 0,8,127, 0,8,63, 0,9,222,
    82,7,27, 0,8,111, 0,8,47, 0,9,190,
    0,8,15, 0,8,143, 0,8,79, 0,9,254,
    96,7,256, 0,8,80, 0,8,16, 84,8,115,
    82,7,31, 0,8,112, 0,8,48, 0,9,193,

    80,7,10, 0,8,96, 0,8,32, 0,9,161,
    0,8,0, 0,8,128, 0,8,64, 0,9,225,
    80,7,6, 0,8,88, 0,8,24, 0,9,145,
    83,7,59, 0,8,120, 0,8,56, 0,9,209,
    81,7,17, 0,8,104, 0,8,40, 0,9,177,
    0,8,8, 0,8,136, 0,8,72, 0,9,241,
    80,7,4, 0,8,84, 0,8,20, 85,8,227,
    83,7,43, 0,8,116, 0,8,52, 0,9,201,
    81,7,13, 0,8,100, 0,8,36, 0,9,169,
    0,8,4, 0,8,132, 0,8,68, 0,9,233,
    80,7,8, 0,8,92, 0,8,28, 0,9,153,
    84,7,83, 0,8,124, 0,8,60, 0,9,217,
    82,7,23, 0,8,108, 0,8,44, 0,9,185,
    0,8,12, 0,8,140, 0,8,76, 0,9,249,
    80,7,3, 0,8,82, 0,8,18, 85,8,163,
    83,7,35, 0,8,114, 0,8,50, 0,9,197,
    81,7,11, 0,8,98, 0,8,34, 0,9,165,
    0,8,2, 0,8,130, 0,8,66, 0,9,229,
    80,7,7, 0,8,90, 0,8,26, 0,9,149,
    84,7,67, 0,8,122, 0,8,58, 0,9,213,
    82,7,19, 0,8,106, 0,8,42, 0,9,181,
    0,8,10, 0,8,138, 0,8,74, 0,9,245,
    80,7,5, 0,8,86, 0,8,22, 192,8,0,
    83,7,51, 0,8,118, 0,8,54, 0,9,205,
    81,7,15, 0,8,102, 0,8,38, 0,9,173,
    0,8,6, 0,8,134, 0,8,70, 0,9,237,
    80,7,9, 0,8,94, 0,8,30, 0,9,157,
    84,7,99, 0,8,126, 0,8,62, 0,9,221,
    82,7,27, 0,8,110, 0,8,46, 0,9,189,
    0,8,14, 0,8,142, 0,8,78, 0,9,253,
    96,7,256, 0,8,81, 0,8,17, 85,8,131,
    82,7,31, 0,8,113, 0,8,49, 0,9,195,
    80,7,10, 0,8,97, 0,8,33, 0,9,163,
    0,8,1, 0,8,129, 0,8,65, 0,9,227,
    80,7,6, 0,8,89, 0,8,25, 0,9,147,
    83,7,59, 0,8,121, 0,8,57, 0,9,211,
    81,7,17, 0,8,105, 0,8,41, 0,9,179,
    0,8,9, 0,8,137, 0,8,73, 0,9,243,
    80,7,4, 0,8,85, 0,8,21, 80,8,258,
    83,7,43, 0,8,117, 0,8,53, 0,9,203,
    81,7,13, 0,8,101, 0,8,37, 0,9,171,
    0,8,5, 0,8,133, 0,8,69, 0,9,235,
    80,7,8, 0,8,93, 0,8,29, 0,9,155,
    84,7,83, 0,8,125, 0,8,61, 0,9,219,
    82,7,23, 0,8,109, 0,8,45, 0,9,187,
    0,8,13, 0,8,141, 0,8,77, 0,9,251,
    80,7,3, 0,8,83, 0,8,19, 85,8,195,
    83,7,35, 0,8,115, 0,8,51, 0,9,199,
    81,7,11, 0,8,99, 0,8,35, 0,9,167,
    0,8,3, 0,8,131, 0,8,67, 0,9,231,
    80,7,7, 0,8,91, 0,8,27, 0,9,151,
    84,7,67, 0,8,123, 0,8,59, 0,9,215,
    82,7,19, 0,8,107, 0,8,43, 0,9,183,
    0,8,11, 0,8,139, 0,8,75, 0,9,247,
    80,7,5, 0,8,87, 0,8,23, 192,8,0,
    83,7,51, 0,8,119, 0,8,55, 0,9,207,
    81,7,15, 0,8,103, 0,8,39, 0,9,175,
    0,8,7, 0,8,135, 0,8,71, 0,9,239,
    80,7,9, 0,8,95, 0,8,31, 0,9,159,
    84,7,99, 0,8,127, 0,8,63, 0,9,223,
    82,7,27, 0,8,111, 0,8,47, 0,9,191,
    0,8,15, 0,8,143, 0,8,79, 0,9,255
];
var fixed_td = [
    80,5,1, 87,5,257, 83,5,17, 91,5,4097,
    81,5,5, 89,5,1025, 85,5,65, 93,5,16385,
    80,5,3, 88,5,513, 84,5,33, 92,5,8193,
    82,5,9, 90,5,2049, 86,5,129, 192,5,24577,
    80,5,2, 87,5,385, 83,5,25, 91,5,6145,
    81,5,7, 89,5,1537, 85,5,97, 93,5,24577,
    80,5,4, 88,5,769, 84,5,49, 92,5,12289,
    82,5,13, 90,5,3073, 86,5,193, 192,5,24577
];

  // Tables for deflate from PKZIP's appnote.txt.
  var cplens = [ // Copy lengths for literal codes 257..285
        3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
        35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0
  ];

  // see note #13 above about 258
  var cplext = [ // Extra bits for literal codes 257..285
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
        3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 112, 112  // 112==invalid
  ];

 var cpdist = [ // Copy offsets for distance codes 0..29
        1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
        257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
        8193, 12289, 16385, 24577
  ];

  var cpdext = [ // Extra bits for distance codes
        0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
        7, 7, 8, 8, 9, 9, 10, 10, 11, 11,
        12, 12, 13, 13];

//
// ZStream.java
//

function ZStream() {
}


ZStream.prototype.inflateInit = function(w, nowrap) {
    if (!w) {
	w = DEF_WBITS;
    }
    if (nowrap) {
	nowrap = false;
    }
    this.istate = new Inflate();
    return this.istate.inflateInit(this, nowrap?-w:w);
}

ZStream.prototype.inflate = function(f) {
    if(this.istate==null) return Z_STREAM_ERROR;
    return this.istate.inflate(this, f);
}

ZStream.prototype.inflateEnd = function(){
    if(this.istate==null) return Z_STREAM_ERROR;
    var ret=istate.inflateEnd(this);
    this.istate = null;
    return ret;
}
ZStream.prototype.inflateSync = function(){
    // if(istate == null) return Z_STREAM_ERROR;
    return istate.inflateSync(this);
}
ZStream.prototype.inflateSetDictionary = function(dictionary, dictLength){
    // if(istate == null) return Z_STREAM_ERROR;
    return istate.inflateSetDictionary(this, dictionary, dictLength);
}

/*

  public int deflateInit(int level){
    return deflateInit(level, MAX_WBITS);
  }
  public int deflateInit(int level, boolean nowrap){
    return deflateInit(level, MAX_WBITS, nowrap);
  }
  public int deflateInit(int level, int bits){
    return deflateInit(level, bits, false);
  }
  public int deflateInit(int level, int bits, boolean nowrap){
    dstate=new Deflate();
    return dstate.deflateInit(this, level, nowrap?-bits:bits);
  }
  public int deflate(int flush){
    if(dstate==null){
      return Z_STREAM_ERROR;
    }
    return dstate.deflate(this, flush);
  }
  public int deflateEnd(){
    if(dstate==null) return Z_STREAM_ERROR;
    int ret=dstate.deflateEnd();
    dstate=null;
    return ret;
  }
  public int deflateParams(int level, int strategy){
    if(dstate==null) return Z_STREAM_ERROR;
    return dstate.deflateParams(this, level, strategy);
  }
  public int deflateSetDictionary (byte[] dictionary, int dictLength){
    if(dstate == null)
      return Z_STREAM_ERROR;
    return dstate.deflateSetDictionary(this, dictionary, dictLength);
  }

*/

/*
  // Flush as much pending output as possible. All deflate() output goes
  // through this function so some applications may wish to modify it
  // to avoid allocating a large strm->next_out buffer and copying into it.
  // (See also read_buf()).
  void flush_pending(){
    int len=dstate.pending;

    if(len>avail_out) len=avail_out;
    if(len==0) return;

    if(dstate.pending_buf.length<=dstate.pending_out ||
       next_out.length<=next_out_index ||
       dstate.pending_buf.length<(dstate.pending_out+len) ||
       next_out.length<(next_out_index+len)){
      System.out.println(dstate.pending_buf.length+", "+dstate.pending_out+
			 ", "+next_out.length+", "+next_out_index+", "+len);
      System.out.println("avail_out="+avail_out);
    }

    System.arraycopy(dstate.pending_buf, dstate.pending_out,
		     next_out, next_out_index, len);

    next_out_index+=len;
    dstate.pending_out+=len;
    total_out+=len;
    avail_out-=len;
    dstate.pending-=len;
    if(dstate.pending==0){
      dstate.pending_out=0;
    }
  }

  // Read a new buffer from the current input stream, update the adler32
  // and total number of bytes read.  All deflate() input goes through
  // this function so some applications may wish to modify it to avoid
  // allocating a large strm->next_in buffer and copying from it.
  // (See also flush_pending()).
  int read_buf(byte[] buf, int start, int size) {
    int len=avail_in;

    if(len>size) len=size;
    if(len==0) return 0;

    avail_in-=len;

    if(dstate.noheader==0) {
      adler=_adler.adler32(adler, next_in, next_in_index, len);
    }
    System.arraycopy(next_in, next_in_index, buf, start, len);
    next_in_index  += len;
    total_in += len;
    return len;
  }

  public void free(){
    next_in=null;
    next_out=null;
    msg=null;
    _adler=null;
  }
}
*/


//
// Inflate.java
//

function Inflate() {
    this.was = [0];
}

Inflate.prototype.inflateReset = function(z) {
    if(z == null || z.istate == null) return Z_STREAM_ERROR;
    
    z.total_in = z.total_out = 0;
    z.msg = null;
    z.istate.mode = z.istate.nowrap!=0 ? BLOCKS : METHOD;
    z.istate.blocks.reset(z, null);
    return Z_OK;
}

Inflate.prototype.inflateEnd = function(z){
    if(this.blocks != null)
      this.blocks.free(z);
    this.blocks=null;
    return Z_OK;
}

Inflate.prototype.inflateInit = function(z, w){
    z.msg = null;
    this.blocks = null;

    // handle undocumented nowrap option (no zlib header or check)
    nowrap = 0;
    if(w < 0){
      w = - w;
      nowrap = 1;
    }

    // set window size
    if(w<8 ||w>15){
      this.inflateEnd(z);
      return Z_STREAM_ERROR;
    }
    this.wbits=w;

    z.istate.blocks=new InfBlocks(z, 
				  z.istate.nowrap!=0 ? null : this,
				  1<<w);

    // reset state
    this.inflateReset(z);
    return Z_OK;
  }

Inflate.prototype.inflate = function(z, f){
    var r, b;

    if(z == null || z.istate == null || z.next_in == null)
      return Z_STREAM_ERROR;
    f = f == Z_FINISH ? Z_BUF_ERROR : Z_OK;
    r = Z_BUF_ERROR;
    while (true){
      switch (z.istate.mode){
      case METHOD:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        if(((z.istate.method = z.next_in[z.next_in_index++])&0xf)!=Z_DEFLATED){
          z.istate.mode = BAD;
          z.msg="unknown compression method";
          z.istate.marker = 5;       // can't try inflateSync
          break;
        }
        if((z.istate.method>>4)+8>z.istate.wbits){
          z.istate.mode = BAD;
          z.msg="invalid window size";
          z.istate.marker = 5;       // can't try inflateSync
          break;
        }
        z.istate.mode=FLAG;
      case FLAG:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        b = (z.next_in[z.next_in_index++])&0xff;

        if((((z.istate.method << 8)+b) % 31)!=0){
          z.istate.mode = BAD;
          z.msg = "incorrect header check";
          z.istate.marker = 5;       // can't try inflateSync
          break;
        }

        if((b&PRESET_DICT)==0){
          z.istate.mode = BLOCKS;
          break;
        }
        z.istate.mode = DICT4;
      case DICT4:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need=((z.next_in[z.next_in_index++]&0xff)<<24)&0xff000000;
        z.istate.mode=DICT3;
      case DICT3:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need+=((z.next_in[z.next_in_index++]&0xff)<<16)&0xff0000;
        z.istate.mode=DICT2;
      case DICT2:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need+=((z.next_in[z.next_in_index++]&0xff)<<8)&0xff00;
        z.istate.mode=DICT1;
      case DICT1:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need += (z.next_in[z.next_in_index++]&0xff);
        z.adler = z.istate.need;
        z.istate.mode = DICT0;
        return Z_NEED_DICT;
      case DICT0:
        z.istate.mode = BAD;
        z.msg = "need dictionary";
        z.istate.marker = 0;       // can try inflateSync
        return Z_STREAM_ERROR;
      case BLOCKS:

        r = z.istate.blocks.proc(z, r);
        if(r == Z_DATA_ERROR){
          z.istate.mode = BAD;
          z.istate.marker = 0;     // can try inflateSync
          break;
        }
        if(r == Z_OK){
          r = f;
        }
        if(r != Z_STREAM_END){
          return r;
        }
        r = f;
        z.istate.blocks.reset(z, z.istate.was);
        if(z.istate.nowrap!=0){
          z.istate.mode=DONE;
          break;
        }
        z.istate.mode=CHECK4;
      case CHECK4:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need=((z.next_in[z.next_in_index++]&0xff)<<24)&0xff000000;
        z.istate.mode=CHECK3;
      case CHECK3:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need+=((z.next_in[z.next_in_index++]&0xff)<<16)&0xff0000;
        z.istate.mode = CHECK2;
      case CHECK2:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need+=((z.next_in[z.next_in_index++]&0xff)<<8)&0xff00;
        z.istate.mode = CHECK1;
      case CHECK1:

        if(z.avail_in==0)return r;r=f;

        z.avail_in--; z.total_in++;
        z.istate.need+=(z.next_in[z.next_in_index++]&0xff);

        if(((z.istate.was[0])) != ((z.istate.need))){
          z.istate.mode = BAD;
          z.msg = "incorrect data check";
          z.istate.marker = 5;       // can't try inflateSync
          break;
        }

        z.istate.mode = DONE;
      case DONE:
        return Z_STREAM_END;
      case BAD:
        return Z_DATA_ERROR;
      default:
        return Z_STREAM_ERROR;
      }
    }
  }


Inflate.prototype.inflateSetDictionary = function(z,  dictionary, dictLength) {
    var index=0;
    var length = dictLength;
    if(z==null || z.istate == null|| z.istate.mode != DICT0)
      return Z_STREAM_ERROR;

    if(z._adler.adler32(1, dictionary, 0, dictLength)!=z.adler){
      return Z_DATA_ERROR;
    }

    z.adler = z._adler.adler32(0, null, 0, 0);

    if(length >= (1<<z.istate.wbits)){
      length = (1<<z.istate.wbits)-1;
      index=dictLength - length;
    }
    z.istate.blocks.set_dictionary(dictionary, index, length);
    z.istate.mode = BLOCKS;
    return Z_OK;
  }

//  static private byte[] mark = {(byte)0, (byte)0, (byte)0xff, (byte)0xff};
var mark = [0, 0, 255, 255]

Inflate.prototype.inflateSync = function(z){
    var n;       // number of bytes to look at
    var p;       // pointer to bytes
    var m;       // number of marker bytes found in a row
    var r, w;   // temporaries to save total_in and total_out

    // set up
    if(z == null || z.istate == null)
      return Z_STREAM_ERROR;
    if(z.istate.mode != BAD){
      z.istate.mode = BAD;
      z.istate.marker = 0;
    }
    if((n=z.avail_in)==0)
      return Z_BUF_ERROR;
    p=z.next_in_index;
    m=z.istate.marker;

    // search
    while (n!=0 && m < 4){
      if(z.next_in[p] == mark[m]){
        m++;
      }
      else if(z.next_in[p]!=0){
        m = 0;
      }
      else{
        m = 4 - m;
      }
      p++; n--;
    }

    // restore
    z.total_in += p-z.next_in_index;
    z.next_in_index = p;
    z.avail_in = n;
    z.istate.marker = m;

    // return no joy or set up to restart on a new block
    if(m != 4){
      return Z_DATA_ERROR;
    }
    r=z.total_in;  w=z.total_out;
    this.inflateReset(z);
    z.total_in=r;  z.total_out = w;
    z.istate.mode = BLOCKS;
    return Z_OK;
}

  // Returns true if inflate is currently at the end of a block generated
  // by Z_SYNC_FLUSH or Z_FULL_FLUSH. This function is used by one PPP
  // implementation to provide an additional safety check. PPP uses Z_SYNC_FLUSH
  // but removes the length bytes of the resulting empty stored block. When
  // decompressing, PPP checks that at the end of input packet, inflate is
  // waiting for these length bytes.
Inflate.prototype.inflateSyncPoint = function(z){
    if(z == null || z.istate == null || z.istate.blocks == null)
      return Z_STREAM_ERROR;
    return z.istate.blocks.sync_point();
}


//
// InfBlocks.java
//

var INFBLOCKS_BORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function InfBlocks(z, checkfn, w) {
    this.hufts=new Int32Array(MANY*3);
    this.window=new Uint8Array(w);
    this.end=w;
    this.checkfn = checkfn;
    this.mode = IB_TYPE;
    this.reset(z, null);

    this.left = 0;            // if STORED, bytes left to copy 

    this.table = 0;           // table lengths (14 bits) 
    this.index = 0;           // index into blens (or border) 
    this.blens = null;         // bit lengths of codes 
    this.bb=new Int32Array(1); // bit length tree depth 
    this.tb=new Int32Array(1); // bit length decoding tree 

    this.codes = new InfCodes();

    this.last = 0;            // true if this block is the last block 

  // mode independent information 
    this.bitk = 0;            // bits in bit buffer 
    this.bitb = 0;            // bit buffer 
    this.read = 0;            // window read pointer 
    this.write = 0;           // window write pointer 
    this.check = 0;          // check on output 

    this.inftree=new InfTree();
}




InfBlocks.prototype.reset = function(z, c){
    if(c) c[0]=this.check;
    if(this.mode==IB_CODES){
      this.codes.free(z);
    }
    this.mode=IB_TYPE;
    this.bitk=0;
    this.bitb=0;
    this.read=this.write=0;

    if(this.checkfn)
      z.adler=this.check=z._adler.adler32(0, null, 0, 0);
  }

 InfBlocks.prototype.proc = function(z, r){
    var t;              // temporary storage
    var b;              // bit buffer
    var k;              // bits in bit buffer
    var p;              // input data pointer
    var n;              // bytes available there
    var q;              // output window write pointer
    var m;              // bytes to end of window or read pointer

    // copy input/output information to locals (UPDATE macro restores)
    {p=z.next_in_index;n=z.avail_in;b=this.bitb;k=this.bitk;}
    {q=this.write;m=(q<this.read ? this.read-q-1 : this.end-q);}

    // process input based on current state
    while(true){
      switch (this.mode){
      case IB_TYPE:

	while(k<(3)){
	  if(n!=0){
	    r=Z_OK;
	  }
	  else{
	    this.bitb=b; this.bitk=k; 
	    z.avail_in=n;
	    z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    this.write=q;
	    return this.inflate_flush(z,r);
	  };
	  n--;
	  b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}
	t = (b & 7);
	this.last = t & 1;

	switch (t >>> 1){
        case 0:                         // stored 
          {b>>>=(3);k-=(3);}
          t = k & 7;                    // go to byte boundary

          {b>>>=(t);k-=(t);}
          this.mode = IB_LENS;                  // get length of stored block
          break;
        case 1:                         // fixed
          {
              var bl=new Int32Array(1);
	      var bd=new Int32Array(1);
              var tl=[];
	      var td=[];

	      inflate_trees_fixed(bl, bd, tl, td, z);
              this.codes.init(bl[0], bd[0], tl[0], 0, td[0], 0, z);
          }

          {b>>>=(3);k-=(3);}

          this.mode = IB_CODES;
          break;
        case 2:                         // dynamic

          {b>>>=(3);k-=(3);}

          this.mode = IB_TABLE;
          break;
        case 3:                         // illegal

          {b>>>=(3);k-=(3);}
          this.mode = BAD;
          z.msg = "invalid block type";
          r = Z_DATA_ERROR;

	  this.bitb=b; this.bitk=k; 
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  this.write=q;
	  return this.inflate_flush(z,r);
	}
	break;
      case IB_LENS:
	while(k<(32)){
	  if(n!=0){
	    r=Z_OK;
	  }
	  else{
	    this.bitb=b; this.bitk=k; 
	    z.avail_in=n;
	    z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    this.write=q;
	    return this.inflate_flush(z,r);
	  };
	  n--;
	  b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}

	if ((((~b) >>> 16) & 0xffff) != (b & 0xffff)){
	  this.mode = BAD;
	  z.msg = "invalid stored block lengths";
	  r = Z_DATA_ERROR;

	  this.bitb=b; this.bitk=k; 
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  this.write=q;
	  return this.inflate_flush(z,r);
	}
	this.left = (b & 0xffff);
	b = k = 0;                       // dump bits
	this.mode = left!=0 ? IB_STORED : (this.last!=0 ? IB_DRY : IB_TYPE);
	break;
      case IB_STORED:
	if (n == 0){
	  this.bitb=b; this.bitk=k; 
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  write=q;
	  return this.inflate_flush(z,r);
	}

	if(m==0){
	  if(q==end&&read!=0){
	    q=0; m=(q<this.read ? this.read-q-1 : this.end-q);
	  }
	  if(m==0){
	    this.write=q; 
	    r=this.inflate_flush(z,r);
	    q=this.write; m = (q < this.read ? this.read-q-1 : this.end-q);
	    if(q==this.end && this.read != 0){
	      q=0; m = (q < this.read ? this.read-q-1 : this.end-q);
	    }
	    if(m==0){
	      this.bitb=b; this.bitk=k; 
	      z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	      this.write=q;
	      return this.inflate_flush(z,r);
	    }
	  }
	}
	r=Z_OK;

	t = this.left;
	if(t>n) t = n;
	if(t>m) t = m;
	arrayCopy(z.next_in, p, window, q, t);
	p += t;  n -= t;
	q += t;  m -= t;
	if ((this.left -= t) != 0)
	  break;
	this.mode = (this.last != 0 ? IB_DRY : IB_TYPE);
	break;
      case IB_TABLE:

	while(k<(14)){
	  if(n!=0){
	    r=Z_OK;
	  }
	  else{
	    this.bitb=b; this.bitk=k; 
	    z.avail_in=n;
	    z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    this.write=q;
	    return this.inflate_flush(z,r);
	  };
	  n--;
	  b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}

	this.table = t = (b & 0x3fff);
	if ((t & 0x1f) > 29 || ((t >> 5) & 0x1f) > 29)
	  {
	    this.mode = IB_BAD;
	    z.msg = "too many length or distance symbols";
	    r = Z_DATA_ERROR;

	    this.bitb=b; this.bitk=k; 
	    z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    this.write=q;
	    return this.inflate_flush(z,r);
	  }
	t = 258 + (t & 0x1f) + ((t >> 5) & 0x1f);
	if(this.blens==null || this.blens.length<t){
	    this.blens=new Int32Array(t);
	}
	else{
	  for(var i=0; i<t; i++){
              this.blens[i]=0;
          }
	}

	{b>>>=(14);k-=(14);}

	this.index = 0;
	mode = IB_BTREE;
      case IB_BTREE:
	while (this.index < 4 + (this.table >>> 10)){
	  while(k<(3)){
	    if(n!=0){
	      r=Z_OK;
	    }
	    else{
	      this.bitb=b; this.bitk=k; 
	      z.avail_in=n;
	      z.total_in+=p-z.next_in_index;z.next_in_index=p;
	      this.write=q;
	      return this.inflate_flush(z,r);
	    };
	    n--;
	    b|=(z.next_in[p++]&0xff)<<k;
	    k+=8;
	  }

	  this.blens[INFBLOCKS_BORDER[this.index++]] = b&7;

	  {b>>>=(3);k-=(3);}
	}

	while(this.index < 19){
	  this.blens[INFBLOCKS_BORDER[this.index++]] = 0;
	}

	this.bb[0] = 7;
	t = this.inftree.inflate_trees_bits(this.blens, this.bb, this.tb, this.hufts, z);
	if (t != Z_OK){
	  r = t;
	  if (r == Z_DATA_ERROR){
	    this.blens=null;
	    this.mode = IB_BAD;
	  }

	  this.bitb=b; this.bitk=k; 
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  write=q;
	  return this.inflate_flush(z,r);
	}

	this.index = 0;
	this.mode = IB_DTREE;
      case IB_DTREE:
	while (true){
	  t = this.table;
	  if(!(this.index < 258 + (t & 0x1f) + ((t >> 5) & 0x1f))){
	    break;
	  }

	  var h; //int[]
	  var i, j, c;

	  t = this.bb[0];

	  while(k<(t)){
	    if(n!=0){
	      r=Z_OK;
	    }
	    else{
	      this.bitb=b; this.bitk=k; 
	      z.avail_in=n;
	      z.total_in+=p-z.next_in_index;z.next_in_index=p;
	      this.write=q;
	      return this.inflate_flush(z,r);
	    };
	    n--;
	    b|=(z.next_in[p++]&0xff)<<k;
	    k+=8;
	  }

//	  if (this.tb[0]==-1){
//            dlog("null...");
//	  }

	  t=this.hufts[(this.tb[0]+(b & inflate_mask[t]))*3+1];
	  c=this.hufts[(this.tb[0]+(b & inflate_mask[t]))*3+2];

	  if (c < 16){
	    b>>>=(t);k-=(t);
	    this.blens[this.index++] = c;
	  }
	  else { // c == 16..18
	    i = c == 18 ? 7 : c - 14;
	    j = c == 18 ? 11 : 3;

	    while(k<(t+i)){
	      if(n!=0){
		r=Z_OK;
	      }
	      else{
		this.bitb=b; this.bitk=k; 
		z.avail_in=n;
		z.total_in+=p-z.next_in_index;z.next_in_index=p;
		this.write=q;
		return this.inflate_flush(z,r);
	      };
	      n--;
	      b|=(z.next_in[p++]&0xff)<<k;
	      k+=8;
	    }

	    b>>>=(t);k-=(t);

	    j += (b & inflate_mask[i]);

	    b>>>=(i);k-=(i);

	    i = this.index;
	    t = this.table;
	    if (i + j > 258 + (t & 0x1f) + ((t >> 5) & 0x1f) ||
		(c == 16 && i < 1)){
	      this.blens=null;
	      this.mode = IB_BAD;
	      z.msg = "invalid bit length repeat";
	      r = Z_DATA_ERROR;

	      this.bitb=b; this.bitk=k; 
	      z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	      this.write=q;
	      return this.inflate_flush(z,r);
	    }

	    c = c == 16 ? this.blens[i-1] : 0;
	    do{
	      this.blens[i++] = c;
	    }
	    while (--j!=0);
	    this.index = i;
	  }
	}

	this.tb[0]=-1;
	{
	    var bl=new Int32Array(1);
	    var bd=new Int32Array(1);
	    var tl=new Int32Array(1);
	    var td=new Int32Array(1);
	    bl[0] = 9;         // must be <= 9 for lookahead assumptions
	    bd[0] = 6;         // must be <= 9 for lookahead assumptions

	    t = this.table;
	    t = this.inftree.inflate_trees_dynamic(257 + (t & 0x1f), 
					      1 + ((t >> 5) & 0x1f),
					      this.blens, bl, bd, tl, td, this.hufts, z);

	    if (t != Z_OK){
	        if (t == Z_DATA_ERROR){
	            this.blens=null;
	            this.mode = BAD;
	        }
	        r = t;

	        this.bitb=b; this.bitk=k; 
	        z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	        this.write=q;
	        return this.inflate_flush(z,r);
	    }
	    this.codes.init(bl[0], bd[0], this.hufts, tl[0], this.hufts, td[0], z);
	}
	this.mode = IB_CODES;
      case IB_CODES:
	this.bitb=b; this.bitk=k;
	z.avail_in=n; z.total_in+=p-z.next_in_index;z.next_in_index=p;
	this.write=q;

	if ((r = this.codes.proc(this, z, r)) != Z_STREAM_END){
	  return this.inflate_flush(z, r);
	}
	r = Z_OK;
	this.codes.free(z);

	p=z.next_in_index; n=z.avail_in;b=this.bitb;k=this.bitk;
	q=this.write;m = (q < this.read ? this.read-q-1 : this.end-q);

	if (this.last==0){
	  this.mode = IB_TYPE;
	  break;
	}
	this.mode = IB_DRY;
      case IB_DRY:
	this.write=q; 
	r = this.inflate_flush(z, r); 
	q=this.write; m = (q < this.read ? this.read-q-1 : this.end-q);
	if (this.read != this.write){
	  this.bitb=b; this.bitk=k; 
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  this.write=q;
	  return this.inflate_flush(z, r);
	}
	mode = DONE;
      case IB_DONE:
	r = Z_STREAM_END;

	this.bitb=b; this.bitk=k; 
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	this.write=q;
	return this.inflate_flush(z, r);
      case IB_BAD:
	r = Z_DATA_ERROR;

	this.bitb=b; this.bitk=k; 
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	this.write=q;
	return this.inflate_flush(z, r);

      default:
	r = Z_STREAM_ERROR;

	this.bitb=b; this.bitk=k; 
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	this.write=q;
	return this.inflate_flush(z, r);
      }
    }
  }

InfBlocks.prototype.free = function(z){
    this.reset(z, null);
    this.window=null;
    this.hufts=null;
}

InfBlocks.prototype.set_dictionary = function(d, start, n){
    arrayCopy(d, start, window, 0, n);
    this.read = this.write = n;
}

  // Returns true if inflate is currently at the end of a block generated
  // by Z_SYNC_FLUSH or Z_FULL_FLUSH. 
InfBlocks.prototype.sync_point = function(){
    return this.mode == IB_LENS;
}

  // copy as much as possible from the sliding window to the output area
InfBlocks.prototype.inflate_flush = function(z, r){
    var n;
    var p;
    var q;

    // local copies of source and destination pointers
    p = z.next_out_index;
    q = this.read;

    // compute number of bytes to copy as far as end of window
    n = ((q <= this.write ? this.write : this.end) - q);
    if (n > z.avail_out) n = z.avail_out;
    if (n!=0 && r == Z_BUF_ERROR) r = Z_OK;

    // update counters
    z.avail_out -= n;
    z.total_out += n;

    // update check information
    if(this.checkfn != null)
      z.adler=this.check=z._adler.adler32(this.check, this.window, q, n);

    // copy as far as end of window
    arrayCopy(this.window, q, z.next_out, p, n);
    p += n;
    q += n;

    // see if more to copy at beginning of window
    if (q == this.end){
      // wrap pointers
      q = 0;
      if (this.write == this.end)
        this.write = 0;

      // compute bytes to copy
      n = this.write - q;
      if (n > z.avail_out) n = z.avail_out;
      if (n!=0 && r == Z_BUF_ERROR) r = Z_OK;

      // update counters
      z.avail_out -= n;
      z.total_out += n;

      // update check information
      if(this.checkfn != null)
	z.adler=this.check=z._adler.adler32(this.check, this.window, q, n);

      // copy
      arrayCopy(this.window, q, z.next_out, p, n);
      p += n;
      q += n;
    }

    // update pointers
    z.next_out_index = p;
    this.read = q;

    // done
    return r;
  }

//
// InfCodes.java
//

var IC_START=0;  // x: set up for LEN
var IC_LEN=1;    // i: get length/literal/eob next
var IC_LENEXT=2; // i: getting length extra (have base)
var IC_DIST=3;   // i: get distance next
var IC_DISTEXT=4;// i: getting distance extra
var IC_COPY=5;   // o: copying bytes in window, waiting for space
var IC_LIT=6;    // o: got literal, waiting for output space
var IC_WASH=7;   // o: got eob, possibly still output waiting
var IC_END=8;    // x: got eob and all data flushed
var IC_BADCODE=9;// x: got error

function InfCodes() {
}

InfCodes.prototype.init = function(bl, bd, tl, tl_index, td, td_index, z) {
    this.mode=IC_START;
    this.lbits=bl;
    this.dbits=bd;
    this.ltree=tl;
    this.ltree_index=tl_index;
    this.dtree = td;
    this.dtree_index=td_index;
    this.tree=null;
}

InfCodes.prototype.proc = function(s, z, r){ 
    var j;              // temporary storage
    var t;              // temporary pointer (int[])
    var tindex;         // temporary pointer
    var e;              // extra bits or operation
    var b=0;            // bit buffer
    var k=0;            // bits in bit buffer
    var p=0;            // input data pointer
    var n;              // bytes available there
    var q;              // output window write pointer
    var m;              // bytes to end of window or read pointer
    var f;              // pointer to copy strings from

    // copy input/output information to locals (UPDATE macro restores)
    p=z.next_in_index;n=z.avail_in;b=s.bitb;k=s.bitk;
    q=s.write;m=q<s.read?s.read-q-1:s.end-q;

    // process input and output based on current state
    while (true){
      switch (this.mode){
	// waiting for "i:"=input, "o:"=output, "x:"=nothing
      case IC_START:         // x: set up for LEN
	if (m >= 258 && n >= 10){

	  s.bitb=b;s.bitk=k;
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  s.write=q;
	  r = this.inflate_fast(this.lbits, this.dbits, 
			   this.ltree, this.ltree_index, 
			   this.dtree, this.dtree_index,
			   s, z);

	  p=z.next_in_index;n=z.avail_in;b=s.bitb;k=s.bitk;
	  q=s.write;m=q<s.read?s.read-q-1:s.end-q;

	  if (r != Z_OK){
	    this.mode = r == Z_STREAM_END ? IC_WASH : IC_BADCODE;
	    break;
	  }
	}
	this.need = this.lbits;
	this.tree = this.ltree;
	this.tree_index=this.ltree_index;

	this.mode = IC_LEN;
      case IC_LEN:           // i: get length/literal/eob next
	j = this.need;

	while(k<(j)){
	  if(n!=0)r=Z_OK;
	  else{

	    s.bitb=b;s.bitk=k;
	    z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    s.write=q;
	    return s.inflate_flush(z,r);
	  }
	  n--;
	  b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}

	tindex=(this.tree_index+(b&inflate_mask[j]))*3;

	b>>>=(this.tree[tindex+1]);
	k-=(this.tree[tindex+1]);

	e=this.tree[tindex];

	if(e == 0){               // literal
	  this.lit = this.tree[tindex+2];
	  this.mode = IC_LIT;
	  break;
	}
	if((e & 16)!=0 ){          // length
	  this.get = e & 15;
	  this.len = this.tree[tindex+2];
	  this.mode = IC_LENEXT;
	  break;
	}
	if ((e & 64) == 0){        // next table
	  this.need = e;
	  this.tree_index = tindex/3 + this.tree[tindex+2];
	  break;
	}
	if ((e & 32)!=0){               // end of block
	  this.mode = IC_WASH;
	  break;
	}
	this.mode = IC_BADCODE;        // invalid code
	z.msg = "invalid literal/length code";
	r = Z_DATA_ERROR;

	s.bitb=b;s.bitk=k;
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	s.write=q;
	return s.inflate_flush(z,r);

      case IC_LENEXT:        // i: getting length extra (have base)
	j = this.get;

	while(k<(j)){
	  if(n!=0)r=Z_OK;
	  else{

	    s.bitb=b;s.bitk=k;
	    z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    s.write=q;
	    return s.inflate_flush(z,r);
	  }
	  n--; b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}

	this.len += (b & inflate_mask[j]);

	b>>=j;
	k-=j;

	this.need = this.dbits;
	this.tree = this.dtree;
	this.tree_index = this.dtree_index;
	this.mode = IC_DIST;
      case IC_DIST:          // i: get distance next
	j = this.need;

	while(k<(j)){
	  if(n!=0)r=Z_OK;
	  else{

	    s.bitb=b;s.bitk=k;
	    z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    s.write=q;
	    return s.inflate_flush(z,r);
	  }
	  n--; b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}

	tindex=(this.tree_index+(b & inflate_mask[j]))*3;

	b>>=this.tree[tindex+1];
	k-=this.tree[tindex+1];

	e = (this.tree[tindex]);
	if((e & 16)!=0){               // distance
	  this.get = e & 15;
	  this.dist = this.tree[tindex+2];
	  this.mode = IC_DISTEXT;
	  break;
	}
	if ((e & 64) == 0){        // next table
	  this.need = e;
	  this.tree_index = tindex/3 + this.tree[tindex+2];
	  break;
	}
	this.mode = IC_BADCODE;        // invalid code
	z.msg = "invalid distance code";
	r = Z_DATA_ERROR;

	s.bitb=b;s.bitk=k;
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	s.write=q;
	return s.inflate_flush(z,r);

      case IC_DISTEXT:       // i: getting distance extra
	j = this.get;

	while(k<(j)){
	  if(n!=0)r=Z_OK;
	  else{

	    s.bitb=b;s.bitk=k;
	    z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	    s.write=q;
	    return s.inflate_flush(z,r);
	  }
	  n--; b|=(z.next_in[p++]&0xff)<<k;
	  k+=8;
	}

	this.dist += (b & inflate_mask[j]);

	b>>=j;
	k-=j;

	this.mode = IC_COPY;
      case IC_COPY:          // o: copying bytes in window, waiting for space
        f = q - this.dist;
        while(f < 0){     // modulo window size-"while" instead
          f += s.end;     // of "if" handles invalid distances
	}
	while (this.len!=0){

	  if(m==0){
	    if(q==s.end&&s.read!=0){q=0;m=q<s.read?s.read-q-1:s.end-q;}
	    if(m==0){
	      s.write=q; r=s.inflate_flush(z,r);
	      q=s.write;m=q<s.read?s.read-q-1:s.end-q;

	      if(q==s.end&&s.read!=0){q=0;m=q<s.read?s.read-q-1:s.end-q;}

	      if(m==0){
		s.bitb=b;s.bitk=k;
		z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
		s.write=q;
		return s.inflate_flush(z,r);
	      }  
	    }
	  }

	  s.window[q++]=s.window[f++]; m--;

	  if (f == s.end)
            f = 0;
	  this.len--;
	}
	this.mode = IC_START;
	break;
      case IC_LIT:           // o: got literal, waiting for output space
	if(m==0){
	  if(q==s.end&&s.read!=0){q=0;m=q<s.read?s.read-q-1:s.end-q;}
	  if(m==0){
	    s.write=q; r=s.inflate_flush(z,r);
	    q=s.write;m=q<s.read?s.read-q-1:s.end-q;

	    if(q==s.end&&s.read!=0){q=0;m=q<s.read?s.read-q-1:s.end-q;}
	    if(m==0){
	      s.bitb=b;s.bitk=k;
	      z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	      s.write=q;
	      return s.inflate_flush(z,r);
	    }
	  }
	}
	r=Z_OK;

	s.window[q++]=this.lit; m--;

	this.mode = IC_START;
	break;
      case IC_WASH:           // o: got eob, possibly more output
	if (k > 7){        // return unused byte, if any
	  k -= 8;
	  n++;
	  p--;             // can always return one
	}

	s.write=q; r=s.inflate_flush(z,r);
	q=s.write;m=q<s.read?s.read-q-1:s.end-q;

	if (s.read != s.write){
	  s.bitb=b;s.bitk=k;
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  s.write=q;
	  return s.inflate_flush(z,r);
	}
	this.mode = IC_END;
      case IC_END:
	r = Z_STREAM_END;
	s.bitb=b;s.bitk=k;
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	s.write=q;
	return s.inflate_flush(z,r);

      case IC_BADCODE:       // x: got error

	r = Z_DATA_ERROR;

	s.bitb=b;s.bitk=k;
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	s.write=q;
	return s.inflate_flush(z,r);

      default:
	r = Z_STREAM_ERROR;

	s.bitb=b;s.bitk=k;
	z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	s.write=q;
	return s.inflate_flush(z,r);
      }
    }
  }

InfCodes.prototype.free = function(z){
    //  ZFREE(z, c);
}

  // Called with number of bytes left to write in window at least 258
  // (the maximum string length) and number of input bytes available
  // at least ten.  The ten bytes are six bytes for the longest length/
  // distance pair plus four bytes for overloading the bit buffer.

InfCodes.prototype.inflate_fast = function(bl, bd, tl, tl_index, td, td_index, s, z) {
    var t;                // temporary pointer
    var   tp;             // temporary pointer (int[])
    var tp_index;         // temporary pointer
    var e;                // extra bits or operation
    var b;                // bit buffer
    var k;                // bits in bit buffer
    var p;                // input data pointer
    var n;                // bytes available there
    var q;                // output window write pointer
    var m;                // bytes to end of window or read pointer
    var ml;               // mask for literal/length tree
    var md;               // mask for distance tree
    var c;                // bytes to copy
    var d;                // distance back to copy from
    var r;                // copy source pointer

    var tp_index_t_3;     // (tp_index+t)*3

    // load input, output, bit values
    p=z.next_in_index;n=z.avail_in;b=s.bitb;k=s.bitk;
    q=s.write;m=q<s.read?s.read-q-1:s.end-q;

    // initialize masks
    ml = inflate_mask[bl];
    md = inflate_mask[bd];

    // do until not enough input or output space for fast loop
    do {                          // assume called with m >= 258 && n >= 10
      // get literal/length code
      while(k<(20)){              // max bits for literal/length code
	n--;
	b|=(z.next_in[p++]&0xff)<<k;k+=8;
      }

      t= b&ml;
      tp=tl; 
      tp_index=tl_index;
      tp_index_t_3=(tp_index+t)*3;
      if ((e = tp[tp_index_t_3]) == 0){
	b>>=(tp[tp_index_t_3+1]); k-=(tp[tp_index_t_3+1]);

	s.window[q++] = tp[tp_index_t_3+2];
	m--;
	continue;
      }
      do {

	b>>=(tp[tp_index_t_3+1]); k-=(tp[tp_index_t_3+1]);

	if((e&16)!=0){
	  e &= 15;
	  c = tp[tp_index_t_3+2] + (b & inflate_mask[e]);

	  b>>=e; k-=e;

	  // decode distance base of block to copy
	  while(k<(15)){           // max bits for distance code
	    n--;
	    b|=(z.next_in[p++]&0xff)<<k;k+=8;
	  }

	  t= b&md;
	  tp=td;
	  tp_index=td_index;
          tp_index_t_3=(tp_index+t)*3;
	  e = tp[tp_index_t_3];

	  do {

	    b>>=(tp[tp_index_t_3+1]); k-=(tp[tp_index_t_3+1]);

	    if((e&16)!=0){
	      // get extra bits to add to distance base
	      e &= 15;
	      while(k<(e)){         // get extra bits (up to 13)
		n--;
		b|=(z.next_in[p++]&0xff)<<k;k+=8;
	      }

	      d = tp[tp_index_t_3+2] + (b&inflate_mask[e]);

	      b>>=(e); k-=(e);

	      // do the copy
	      m -= c;
	      if (q >= d){                // offset before dest
		//  just copy
		r=q-d;
		if(q-r>0 && 2>(q-r)){           
		  s.window[q++]=s.window[r++]; // minimum count is three,
		  s.window[q++]=s.window[r++]; // so unroll loop a little
		  c-=2;
		}
		else{
		  arrayCopy(s.window, r, s.window, q, 2);
		  q+=2; r+=2; c-=2;
		}
	      }
	      else{                  // else offset after destination
                r=q-d;
                do{
                  r+=s.end;          // force pointer in window
                }while(r<0);         // covers invalid distances
		e=s.end-r;
		if(c>e){             // if source crosses,
		  c-=e;              // wrapped copy
		  if(q-r>0 && e>(q-r)){           
		    do{s.window[q++] = s.window[r++];}
		    while(--e!=0);
		  }
		  else{
		    arrayCopy(s.window, r, s.window, q, e);
		    q+=e; r+=e; e=0;
		  }
		  r = 0;                  // copy rest from start of window
		}

	      }

	      // copy all or what's left
	      if(q-r>0 && c>(q-r)){           
		do{s.window[q++] = s.window[r++];}
		while(--c!=0);
	      }
	      else{
		arrayCopy(s.window, r, s.window, q, c);
		q+=c; r+=c; c=0;
	      }
	      break;
	    }
	    else if((e&64)==0){
	      t+=tp[tp_index_t_3+2];
	      t+=(b&inflate_mask[e]);
	      tp_index_t_3=(tp_index+t)*3;
	      e=tp[tp_index_t_3];
	    }
	    else{
	      z.msg = "invalid distance code";

	      c=z.avail_in-n;c=(k>>3)<c?k>>3:c;n+=c;p-=c;k-=c<<3;

	      s.bitb=b;s.bitk=k;
	      z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	      s.write=q;

	      return Z_DATA_ERROR;
	    }
	  }
	  while(true);
	  break;
	}

	if((e&64)==0){
	  t+=tp[tp_index_t_3+2];
	  t+=(b&inflate_mask[e]);
	  tp_index_t_3=(tp_index+t)*3;
	  if((e=tp[tp_index_t_3])==0){

	    b>>=(tp[tp_index_t_3+1]); k-=(tp[tp_index_t_3+1]);

	    s.window[q++]=tp[tp_index_t_3+2];
	    m--;
	    break;
	  }
	}
	else if((e&32)!=0){

	  c=z.avail_in-n;c=(k>>3)<c?k>>3:c;n+=c;p-=c;k-=c<<3;
 
	  s.bitb=b;s.bitk=k;
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  s.write=q;

	  return Z_STREAM_END;
	}
	else{
	  z.msg="invalid literal/length code";

	  c=z.avail_in-n;c=(k>>3)<c?k>>3:c;n+=c;p-=c;k-=c<<3;

	  s.bitb=b;s.bitk=k;
	  z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
	  s.write=q;

	  return Z_DATA_ERROR;
	}
      } 
      while(true);
    } 
    while(m>=258 && n>= 10);

    // not enough input or output--restore pointers and return
    c=z.avail_in-n;c=(k>>3)<c?k>>3:c;n+=c;p-=c;k-=c<<3;

    s.bitb=b;s.bitk=k;
    z.avail_in=n;z.total_in+=p-z.next_in_index;z.next_in_index=p;
    s.write=q;

    return Z_OK;
}

//
// InfTree.java
//

function InfTree() {
}

InfTree.prototype.huft_build = function(b, bindex, n, s, d, e, t, m, hp, hn, v) {

    // Given a list of code lengths and a maximum table size, make a set of
    // tables to decode that set of codes.  Return Z_OK on success, Z_BUF_ERROR
    // if the given code set is incomplete (the tables are still built in this
    // case), Z_DATA_ERROR if the input is invalid (an over-subscribed set of
    // lengths), or Z_MEM_ERROR if not enough memory.

    var a;                       // counter for codes of length k
    var f;                       // i repeats in table every f entries
    var g;                       // maximum code length
    var h;                       // table level
    var i;                       // counter, current code
    var j;                       // counter
    var k;                       // number of bits in current code
    var l;                       // bits per table (returned in m)
    var mask;                    // (1 << w) - 1, to avoid cc -O bug on HP
    var p;                       // pointer into c[], b[], or v[]
    var q;                       // points to current table
    var w;                       // bits before this table == (l * h)
    var xp;                      // pointer into x
    var y;                       // number of dummy codes added
    var z;                       // number of entries in current table

    // Generate counts for each bit length

    p = 0; i = n;
    do {
      this.c[b[bindex+p]]++; p++; i--;   // assume all entries <= BMAX
    }while(i!=0);

    if(this.c[0] == n){                // null input--all zero length codes
      t[0] = -1;
      m[0] = 0;
      return Z_OK;
    }

    // Find minimum and maximum length, bound *m by those
    l = m[0];
    for (j = 1; j <= BMAX; j++)
      if(this.c[j]!=0) break;
    k = j;                        // minimum code length
    if(l < j){
      l = j;
    }
    for (i = BMAX; i!=0; i--){
      if(this.c[i]!=0) break;
    }
    g = i;                        // maximum code length
    if(l > i){
      l = i;
    }
    m[0] = l;

    // Adjust last length count to fill out codes, if needed
    for (y = 1 << j; j < i; j++, y <<= 1){
      if ((y -= this.c[j]) < 0){
        return Z_DATA_ERROR;
      }
    }
    if ((y -= this.c[i]) < 0){
      return Z_DATA_ERROR;
    }
    this.c[i] += y;

    // Generate starting offsets into the value table for each length
    this.x[1] = j = 0;
    p = 1;  xp = 2;
    while (--i!=0) {                 // note that i == g from above
      this.x[xp] = (j += this.c[p]);
      xp++;
      p++;
    }

    // Make a table of values in order of bit lengths
    i = 0; p = 0;
    do {
      if ((j = b[bindex+p]) != 0){
        this.v[this.x[j]++] = i;
      }
      p++;
    }
    while (++i < n);
    n = this.x[g];                     // set n to length of v

    // Generate the Huffman codes and for each, make the table entries
    this.x[0] = i = 0;                 // first Huffman code is zero
    p = 0;                        // grab values in bit order
    h = -1;                       // no tables yet--level -1
    w = -l;                       // bits decoded == (l * h)
    this.u[0] = 0;                     // just to keep compilers happy
    q = 0;                        // ditto
    z = 0;                        // ditto

    // go through the bit lengths (k already is bits in shortest code)
    for (; k <= g; k++){
      a = this.c[k];
      while (a--!=0){
	// here i is the Huffman code of length k bits for value *p
	// make tables up to required level
        while (k > w + l){
          h++;
          w += l;                 // previous table always l bits
	  // compute minimum size table less than or equal to l bits
          z = g - w;
          z = (z > l) ? l : z;        // table size upper limit
          if((f=1<<(j=k-w))>a+1){     // try a k-w bit table
                                      // too few codes for k-w bit table
            f -= a + 1;               // deduct codes from patterns left
            xp = k;
            if(j < z){
              while (++j < z){        // try smaller tables up to z bits
                if((f <<= 1) <= this.c[++xp])
                  break;              // enough codes to use up j bits
                f -= this.c[xp];           // else deduct codes from patterns
              }
	    }
          }
          z = 1 << j;                 // table entries for j-bit table

	  // allocate new table
          if (this.hn[0] + z > MANY){       // (note: doesn't matter for fixed)
            return Z_DATA_ERROR;       // overflow of MANY
          }
          this.u[h] = q = /*hp+*/ this.hn[0];   // DEBUG
          this.hn[0] += z;
 
	  // connect to last table, if there is one
	  if(h!=0){
            this.x[h]=i;           // save pattern for backing up
            this.r[0]=j;     // bits in this table
            this.r[1]=l;     // bits to dump before this table
            j=i>>>(w - l);
            this.r[2] = (q - this.u[h-1] - j);               // offset to this table
            arrayCopy(this.r, 0, hp, (this.u[h-1]+j)*3, 3); // connect to last table
          }
          else{
            t[0] = q;               // first table is returned result
	  }
        }

	// set up table entry in r
        this.r[1] = (k - w);
        if (p >= n){
          this.r[0] = 128 + 64;      // out of values--invalid code
	}
        else if (v[p] < s){
          this.r[0] = (this.v[p] < 256 ? 0 : 32 + 64);  // 256 is end-of-block
          this.r[2] = this.v[p++];          // simple code is just the value
        }
        else{
          this.r[0]=(e[this.v[p]-s]+16+64); // non-simple--look up in lists
          this.r[2]=d[this.v[p++] - s];
        }

        // fill code-like entries with r
        f=1<<(k-w);
        for (j=i>>>w;j<z;j+=f){
          arrayCopy(this.r, 0, hp, (q+j)*3, 3);
	}

	// backwards increment the k-bit code i
        for (j = 1 << (k - 1); (i & j)!=0; j >>>= 1){
          i ^= j;
	}
        i ^= j;

	// backup over finished tables
        mask = (1 << w) - 1;      // needed on HP, cc -O bug
        while ((i & mask) != this.x[h]){
          h--;                    // don't need to update q
          w -= l;
          mask = (1 << w) - 1;
        }
      }
    }
    // Return Z_BUF_ERROR if we were given an incomplete table
    return y != 0 && g != 1 ? Z_BUF_ERROR : Z_OK;
}

InfTree.prototype.inflate_trees_bits = function(c, bb, tb, hp, z) {
    var result;
    this.initWorkArea(19);
    this.hn[0]=0;
    result = this.huft_build(c, 0, 19, 19, null, null, tb, bb, hp, this.hn, this.v);

    if(result == Z_DATA_ERROR){
      z.msg = "oversubscribed dynamic bit lengths tree";
    }
    else if(result == Z_BUF_ERROR || bb[0] == 0){
      z.msg = "incomplete dynamic bit lengths tree";
      result = Z_DATA_ERROR;
    }
    return result;
}

InfTree.prototype.inflate_trees_dynamic = function(nl, nd, c, bl, bd, tl, td, hp, z) {
    var result;

    // build literal/length tree
    this.initWorkArea(288);
    this.hn[0]=0;
    result = this.huft_build(c, 0, nl, 257, cplens, cplext, tl, bl, hp, this.hn, this.v);
    if (result != Z_OK || bl[0] == 0){
      if(result == Z_DATA_ERROR){
        z.msg = "oversubscribed literal/length tree";
      }
      else if (result != Z_MEM_ERROR){
        z.msg = "incomplete literal/length tree";
        result = Z_DATA_ERROR;
      }
      return result;
    }

    // build distance tree
    this.initWorkArea(288);
    result = this.huft_build(c, nl, nd, 0, cpdist, cpdext, td, bd, hp, this.hn, this.v);

    if (result != Z_OK || (bd[0] == 0 && nl > 257)){
      if (result == Z_DATA_ERROR){
        z.msg = "oversubscribed distance tree";
      }
      else if (result == Z_BUF_ERROR) {
        z.msg = "incomplete distance tree";
        result = Z_DATA_ERROR;
      }
      else if (result != Z_MEM_ERROR){
        z.msg = "empty distance tree with lengths";
        result = Z_DATA_ERROR;
      }
      return result;
    }

    return Z_OK;
}
/*
  static int inflate_trees_fixed(int[] bl,  //literal desired/actual bit depth
                                 int[] bd,  //distance desired/actual bit depth
                                 int[][] tl,//literal/length tree result
                                 int[][] td,//distance tree result 
                                 ZStream z  //for memory allocation
				 ){

*/

function inflate_trees_fixed(bl, bd, tl, td, z) {
    bl[0]=fixed_bl;
    bd[0]=fixed_bd;
    tl[0]=fixed_tl;
    td[0]=fixed_td;
    return Z_OK;
}

InfTree.prototype.initWorkArea = function(vsize){
    if(this.hn==null){
        this.hn=new Int32Array(1);
        this.v=new Int32Array(vsize);
        this.c=new Int32Array(BMAX+1);
        this.r=new Int32Array(3);
        this.u=new Int32Array(BMAX);
        this.x=new Int32Array(BMAX+1);
    }
    if(this.v.length<vsize){ 
        this.v=new Int32Array(vsize); 
    }
    for(var i=0; i<vsize; i++){this.v[i]=0;}
    for(var i=0; i<BMAX+1; i++){this.c[i]=0;}
    for(var i=0; i<3; i++){this.r[i]=0;}
//  for(int i=0; i<BMAX; i++){u[i]=0;}
    arrayCopy(this.c, 0, this.u, 0, BMAX);
//  for(int i=0; i<BMAX+1; i++){x[i]=0;}
    arrayCopy(this.c, 0, this.x, 0, BMAX+1);
}

var testArray = new Uint8Array(1);
var hasSubarray = (typeof testArray.subarray === 'function');
var hasSlice = false; /* (typeof testArray.slice === 'function'); */ // Chrome slice performance is so dire that we're currently not using it...

function arrayCopy(src, srcOffset, dest, destOffset, count) {
    if (count == 0) {
        return;
    } 

    if (!src) {
        throw "Undef src";
    } else if (!dest) {
        throw "Undef dest";
    }

    if (srcOffset == 0 && count == src.length) {
        arrayCopy_fast(src, dest, destOffset);
    } else if (hasSubarray) {
        arrayCopy_fast(src.subarray(srcOffset, srcOffset + count), dest, destOffset); 
    } else if (src.BYTES_PER_ELEMENT == 1 && count > 100) {
        arrayCopy_fast(new Uint8Array(src.buffer, src.byteOffset + srcOffset, count), dest, destOffset);
    } else { 
        arrayCopy_slow(src, srcOffset, dest, destOffset, count);
    }

}

function arrayCopy_slow(src, srcOffset, dest, destOffset, count) {

    // dlog('_slow call: srcOffset=' + srcOffset + '; destOffset=' + destOffset + '; count=' + count);

     for (var i = 0; i < count; ++i) {
        dest[destOffset + i] = src[srcOffset + i];
    }
}

function arrayCopy_fast(src, dest, destOffset) {
    dest.set(src, destOffset);
}


  // largest prime smaller than 65536
var ADLER_BASE=65521; 
  // NMAX is the largest n such that 255n(n+1)/2 + (n+1)(BASE-1) <= 2^32-1
var ADLER_NMAX=5552;

function adler32(adler, /* byte[] */ buf,  index, len){
    if(buf == null){ return 1; }

    var s1=adler&0xffff;
    var s2=(adler>>16)&0xffff;
    var k;

    while(len > 0) {
      k=len<ADLER_NMAX?len:ADLER_NMAX;
      len-=k;
      while(k>=16){
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        s1+=buf[index++]&0xff; s2+=s1;
        k-=16;
      }
      if(k!=0){
        do{
          s1+=buf[index++]&0xff; s2+=s1;
        }
        while(--k!=0);
      }
      s1%=ADLER_BASE;
      s2%=ADLER_BASE;
    }
    return (s2<<16)|s1;
}



function jszlib_inflate_buffer(buffer, start, length, afterUncOffset) {
    if (!start) {
        buffer = new Uint8Array(buffer);
    } else {
        buffer = new Uint8Array(buffer, start, length);
    }

    var z = new ZStream();
    z.inflateInit(DEF_WBITS, true);
    z.next_in = buffer;
    z.next_in_index = 0;
    z.avail_in = buffer.length;

    var oBlockList = [];
    var totalSize = 0;
    while (true) {
        var obuf = new Uint8Array(32000);
        z.next_out = obuf;
        z.next_out_index = 0;
        z.avail_out = obuf.length;
        var status = z.inflate(Z_NO_FLUSH);
        if (status != Z_OK && status != Z_STREAM_END) {
            throw z.msg;
        }
        if (z.avail_out != 0) {
            var newob = new Uint8Array(obuf.length - z.avail_out);
            arrayCopy(obuf, 0, newob, 0, (obuf.length - z.avail_out));
            obuf = newob;
        }
        oBlockList.push(obuf);
        totalSize += obuf.length;
        if (status == Z_STREAM_END) {
            break;
        }
    }

    if (afterUncOffset) {
        afterUncOffset[0] = (start || 0) + z.next_in_index;
    }

    if (oBlockList.length == 1) {
        return oBlockList[0].buffer;
    } else {
        var out = new Uint8Array(totalSize);
        var cursor = 0;
        for (var i = 0; i < oBlockList.length; ++i) {
            var b = oBlockList[i];
            arrayCopy(b, 0, out, cursor, b.length);
            cursor += b.length;
        }
        return out.buffer;
    }
}