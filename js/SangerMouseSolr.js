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

DASSource.prototype.doCrossDomainRequest = function(url, handler) {
    return doCrossDomainRequest(url, handler, this.credentials);
}