package app

import (
 "encoding/binary"
 "fmt"
 "net/http"
 "os"
 "path/filepath"
 "regexp"
 "sort"
 "strings"
)

// GeoSite.dat and GeoIP.dat are protobuf GeoSiteList/GeoIPList messages.
// Extract only category names from their repeated field #1, without copying
// domain/IP entries, and without a network-dependent catalog.
const maxGeoCatalogBytes = 64 << 20
const maxGeoCatalogGroups = 10000

var geoCategoryNamePattern = regexp.MustCompile("^[a-z0-9][a-z0-9._!+-]{0,127}$")

func nextGeoProtoField(data []byte, offset *int) (int, []byte, error) {
 if *offset >= len(data) { return 0, nil, fmt.Errorf("unexpected end of protobuf") }
 tag, n := binary.Uvarint(data[*offset:])
 if n <= 0 || tag == 0 { return 0, nil, fmt.Errorf("invalid protobuf field tag") }
 *offset += n
 fieldNum, wire := int(tag>>3), int(tag&7)
 if fieldNum < 1 { return 0, nil, fmt.Errorf("invalid protobuf field number") }
 switch wire {
 case 0:
  _, n = binary.Uvarint(data[*offset:])
  if n <= 0 { return 0, nil, fmt.Errorf("invalid protobuf varint") }
  *offset += n
 case 1:
  if len(data)-*offset < 8 { return 0,nil,fmt.Errorf("truncated fixed64 field") }
  *offset += 8
 case 2:
  size, n := binary.Uvarint(data[*offset:])
  if n <= 0 { return 0,nil,fmt.Errorf("invalid protobuf length") }
  *offset += n
  if size > uint64(len(data)-*offset) { return 0,nil,fmt.Errorf("truncated protobuf length-delimited field") }
  next := *offset + int(size)
  bytes := data[*offset:next]
  *offset = next
  return fieldNum, bytes, nil
 case 5:
  if len(data)-*offset < 4 { return 0,nil,fmt.Errorf("truncated fixed32 field") }
  *offset += 4
 default:
  return 0,nil,fmt.Errorf("unsupported protobuf wire type %d",wire)
 }
 return fieldNum,nil,nil
}

func parseGeoCatalogNames(raw []byte) ([]string,error) {
 names := map[string]bool{}
 pos:=0
 for pos<len(raw) {
  field, entry, err:=nextGeoProtoField(raw,&pos)
  if err!=nil { return nil,err }
  if field!=1 || entry==nil { continue }
  inner:=0
  for inner<len(entry) {
   subfield,value,err:=nextGeoProtoField(entry,&inner)
   if err!=nil { return nil,err }
   if subfield==1 && value!=nil {
    name:=strings.ToLower(strings.TrimSpace(string(value)))
    if geoCategoryNamePattern.MatchString(name) { names[name]=true }
    break
   }
  }
  if len(names)>maxGeoCatalogGroups { return nil,fmt.Errorf("too many geo categories") }
 }
 if len(names)==0 { return nil,fmt.Errorf("no valid geo categories in local file") }
 result:=make([]string,0,len(names))
 for name:=range names { result=append(result,name) }
 sort.Strings(result)
 return result,nil
}

func geoCatalogNamesFromFile(path string) ([]string,error) {
 info,err:=os.Stat(path)
 if err!=nil { return nil,err }
 if !info.Mode().IsRegular() || info.Size()<1 || info.Size()>maxGeoCatalogBytes {
  return nil,fmt.Errorf("invalid geo catalog file size")
 }
 raw,err:=os.ReadFile(path)
 if err!=nil { return nil,err }
 return parseGeoCatalogNames(raw)
}

// The endpoint is protected by a.auth in panelRoutes.
func (a *App) handleMihomoGeoCategories(w http.ResponseWriter, r *http.Request) {
 w.Header().Set("Cache-Control","no-store")
 if r.Method!=http.MethodGet {
  writeJSON(w,http.StatusMethodNotAllowed,apiResponse{Message:"method not allowed"})
  return
 }
 result:=map[string][]string{}
 for _,source:=range []struct{kind,file string}{{"geosite","GeoSite.dat"},{"geoip","GeoIP.dat"}} {
  names,err:=geoCatalogNamesFromFile(filepath.Join(a.manager.dataDir,source.file))
  if err!=nil {
   writeJSON(w,http.StatusServiceUnavailable,apiResponse{Message:fmt.Sprintf("Не удалось прочитать %s: %v",source.file,err)})
   return
  }
  result[source.kind]=names
 }
 writeJSON(w,http.StatusOK,apiResponse{OK:true,Data:result})
}
