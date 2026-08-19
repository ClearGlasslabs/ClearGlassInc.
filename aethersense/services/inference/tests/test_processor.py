import numpy as np
from services.inference.processor import hampel,unwrap_phase,normalize,BaselineSensingModel

def test_unwrap_phase():
 p=np.array([[0,3.0,-3.0],[0,3.1,-3.1]])
 u=unwrap_phase(p);assert np.isfinite(u).all()
def test_hampel_rejects_spike():
 x=np.ones(21);x[10]=99;y=hampel(x);assert y[10]<2
def test_normalize():
 z=normalize(np.arange(20));assert abs(float(z.mean()))<1e-9;assert np.isclose(z.std(),1)
def test_model_empty():
 r=BaselineSensingModel().infer([]);assert r.vitals['heartRate'].value is None
