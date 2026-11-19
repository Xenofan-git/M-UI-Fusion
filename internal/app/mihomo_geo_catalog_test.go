package app

import (
 "encoding/binary"
 "net/http"
 "net/http/httptest"
 "os"
 "path/filepath"
 "reflect"
 "strings"
 "testing"
)

func wireGeoField(tag uint64, value []byte) []byte {
 result:=binary.AppendUvarint(nil,tag)
 result=binary.AppendUvarint(result,uint64(len(value)))
 return append(result,value...)
}
func geoFixture(names ...string) []byte {
 out:=[]byte{}
 for _,name:=range names { out=append(out,wireGeoField(10,wireGeoField(10,[]byte(name)))...) }
 return out
}
func TestReadInstalledGeoCatalogNames(t *testing.T) {
 names,err:=parseGeoCatalogNames(geoFixture("RU","google","category-ru","GOOGLE","bad,name"))
 if err!=nil { t.Fatal(err) }
 expected:=[]string{"category-ru","google","ru"}
 if !reflect.DeepEqual(names,expected) { t.Fatalf("got %#v, expected %#v",names,expected) }
 for _,raw:=range [][]byte{{10,200,1,1},{10,3,10,10,5},{2}} {
  if _,err:=parseGeoCatalogNames(raw);err==nil {t.Errorf("accepted malformed protobuf %v",raw)}
 }
}
func TestGeoCategoryEndpointLocalFilesAndMethod(t *testing.T) {
 dir:=t.TempDir()
 if err:=os.WriteFile(filepath.Join(dir,"GeoSite.dat"),geoFixture("youtube","category-ru"),0600);err!=nil {t.Fatal(err)}
 if err:=os.WriteFile(filepath.Join(dir,"GeoIP.dat"),geoFixture("RU","DE"),0600);err!=nil {t.Fatal(err)}
 a:=&App{manager:&CoreManager{dataDir:dir}}
 res:=httptest.NewRecorder()
 a.handleMihomoGeoCategories(res,httptest.NewRequest(http.MethodGet,"/api/mihomo/geo-categories",nil))
 if res.Code!=http.StatusOK {t.Fatalf("status=%d body=%s",res.Code,res.Body.String())}
 for _,s:=range []string{"\"geosite\":[\"category-ru\",\"youtube\"]","\"geoip\":[\"de\",\"ru\"]"} {
  if !strings.Contains(res.Body.String(),s) {t.Fatalf("missing %q in %s",s,res.Body.String())}
 }
 res=httptest.NewRecorder()
 a.handleMihomoGeoCategories(res,httptest.NewRequest(http.MethodPost,"/api/mihomo/geo-categories",nil))
 if res.Code!=http.StatusMethodNotAllowed {t.Fatalf("method accepted: %d",res.Code)}
 if err:=os.Remove(filepath.Join(dir,"GeoSite.dat"));err!=nil {t.Fatal(err)}
 res=httptest.NewRecorder()
 a.handleMihomoGeoCategories(res,httptest.NewRequest(http.MethodGet,"/api/mihomo/geo-categories",nil))
 if res.Code!=http.StatusServiceUnavailable {t.Fatalf("missing file silently accepted: %d",res.Code)}
}
